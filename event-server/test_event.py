import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('event_api', ROOT/'server/event_api.py')
api=importlib.util.module_from_spec(spec); spec.loader.exec_module(api)


class EventTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.folder=Path(self.temp.name)
        self.now=1795226400.0
        config=json.loads((ROOT/'server/event.json').read_text())
        config['startsAt']=datetime.fromtimestamp(self.now+3600,timezone.utc).isoformat()
        self.director=api.Director(self.folder,config,lambda:self.now)
        self.game=dict(schema=1,generatedAt=self.now*1000,boot='boot1',ack=0,
            people=[],qualifying=[],race=None,catalog=[dict(dir='Mintop',file='/trackinfo/Mintop.trackinfo',minutes=0,laps=4,eventTrack=False)])

    def tearDown(self):
        self.director.db.close(); self.temp.cleanup()

    def tick(self,advance=0,ack=True):
        self.now+=advance; self.game['generatedAt']=self.now*1000
        if ack: self.game['ack']=self.director.state['actionSeq']
        if self.now>=self.director.deadline and not self.game.get('uidGrab'):
            self.game['uidGrab']=dict(deadline=self.director.deadline,at=self.now,people=copy.deepcopy(self.game['people']))
        api.atomic_json(self.folder/'game.json',self.game)
        self.director.tick()

    def enter(self,uid,ticks=15000,status='Player'):
        self.director.signup(dict(name='Rider '+str(uid),number=str(uid%1000),uid=uid),str(uid))
        self.game['people'].append(dict(uid=uid,status=status,name='Rider '+str(uid),number=uid%1000))
        if ticks: self.game['qualifying'].append(dict(uid=uid,ticks=ticks,at=self.now))

    def race(self,key,minutes,order=None,flag=0):
        self.game['race']=dict(key=key,track='Mintop',minutes=minutes,laps=1,order=order or [],firstCheckered=flag)

    def test_signup_validation_and_duplicates(self):
        self.enter(15155)
        self.assertTrue(self.director.signup(dict(name='Rider 15155',number='155',uid=15155),'same')['ok'])
        for data in (dict(name='X',number='x',uid=5),dict(name='X',number='1',uid=True),dict(name='',number='1',uid=8)):
            with self.assertRaises(ValueError): self.director.signup(data,'bad')
        with self.assertRaises(ValueError): self.director.signup(dict(name='Imposter',number='3',uid=15155),'new')
        self.tick(); self.assertEqual(len(self.director.view()['entries']),1)

    def test_qualifying_persists_and_only_top40_present(self):
        for uid in range(100,145): self.enter(uid,ticks=uid*128)
        self.enter(200,ticks=1,status='Zombie')
        self.enter(201,ticks=None)
        self.tick(); self.director.state['automatic']=False; self.director.grab(); self.director.save()
        self.assertEqual([p['uid'] for p in self.director.state['roster']],list(range(100,140)))
        replacement=api.Director(self.folder,self.director.config,lambda:self.now)
        self.assertEqual(len(replacement.state['roster']),40); replacement.db.close()

    def test_deadline_and_late_times(self):
        self.enter(1,ticks=1000); self.tick()
        self.now=self.director.deadline+1
        with self.assertRaises(ValueError): self.director.signup(dict(name='Late',number='3',uid=3),'late')
        self.game['qualifying'][0].update(ticks=1,at=self.now)
        self.tick()
        self.assertEqual(self.director.view()['entries'][0]['bestTicks'],1000)
        self.assertEqual(self.director.state['phase'],'intermission')

    def test_full_automatic_two_moto_lifecycle(self):
        self.enter(1); self.enter(2,14000); self.tick(); self.director.grab()
        self.tick(16); self.assertEqual(self.director.state['phase'],'starting')
        self.assertTrue(any('addtrack 0 1 -1 ' in c for a in self.director.state['queue'] for c in a['commands']))
        self.race('warmup',0); self.tick(); self.assertEqual(self.director.state['phase'],'warmup')
        done=[dict(uid=1,started=True,finished=True),dict(uid=2,started=True,finished=True)]
        self.race('warmup',0,done,200); self.tick(); self.tick(6)
        self.assertEqual(self.director.state['motos'],{})
        self.tick(31); self.race('m1',15); self.tick()
        self.assertEqual(self.director.state['phase'],'moto1')
        self.race('m1',15,done,200); self.tick(); self.tick(6)
        self.assertEqual(self.director.state['motos']['1'][0]['uid'],1)
        self.tick(31); self.race('m2',15); self.tick()
        self.race('m2',15,list(reversed(done)),200); self.tick(); self.tick(6)
        self.assertEqual(self.director.state['phase'],'releasing')
        self.tick(); self.assertEqual(self.director.state['phase'],'complete')
        self.assertEqual(self.director.view()['overall'][0]['uid'],2)

    def test_aborted_race_never_scores(self):
        self.enter(1); self.tick(); self.director.state['automatic']=False
        self.director.grab(); self.director.begin('moto1'); self.race('m1',15); self.tick()
        self.race('unexpected',15); self.tick()
        self.assertEqual(self.director.state['phase'],'paused')
        self.assertFalse(self.director.state['motos'])
        self.director.command('rerun'); self.assertEqual(self.director.state['phase'],'starting')

    def test_owner_add_remove_results_and_dns(self):
        self.enter(1); self.enter(2); self.enter(3); self.tick(); self.director.state['automatic']=False
        self.director.grab(); self.director.command('remove 3'); self.director.command('add 3')
        self.director.begin('moto1'); self.race('m1',15); self.tick()
        self.race('m1',15,[dict(uid=1,started=True,finished=True),dict(uid=2,started=True,finished=False)],200)
        self.tick(); self.tick(61)
        self.assertEqual([p['status'] for p in self.director.state['motos']['1']],['FIN','DNF','DNS'])
        self.director.command('result 1 2 1')
        rows=self.director.state['motos']['1']
        self.assertEqual(next(p['position'] for p in rows if p['uid']==2),1)
        self.assertEqual(next(p['position'] for p in rows if p['uid']==1),2)

    def test_game_reboot_pauses_active_event(self):
        self.enter(1); self.tick(); self.director.grab(); self.game['boot']='boot2'; self.tick()
        self.assertEqual(self.director.state['phase'],'paused')
        self.assertIn('restarted',self.director.state['error'])

    def test_low_scores_and_second_moto_tiebreak(self):
        roster=[dict(uid=i,name=str(i)) for i in range(1,5)]
        motos={'1':[dict(uid=i,position=p) for i,p in [(1,3),(2,1),(3,3),(4,1)]],
               '2':[dict(uid=i,position=p) for i,p in [(1,1),(2,3),(3,3),(4,5)]]}
        rows=api.overall(roster,motos)
        self.assertEqual([r['uid'] for r in rows],[1,2,3,4])

    def test_pause_disarms_qualifying_and_late_roster_edits(self):
        self.director.command('pause'); self.assertEqual(self.director.state['phase'],'qualifying')
        self.assertFalse(self.director.state['armed'])
        self.enter(1); self.tick(); self.director.grab(); self.director.command('add 1')
        self.assertEqual(len(self.director.state['roster']),1)

    def test_scheduled_grab_uses_frozen_game_presence(self):
        self.enter(1,1000); self.enter(2,2000); self.tick()
        self.game['uidGrab']=dict(deadline=self.director.deadline,at=self.director.deadline,
            people=[copy.deepcopy(self.game['people'][0])])
        self.now=self.director.deadline+2
        self.tick()
        self.assertEqual([p['uid'] for p in self.director.state['roster']],[1])


if __name__=='__main__': unittest.main(verbosity=2)
