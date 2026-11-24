from pathlib import Path
import json,sys,tempfile,unittest,copy
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT/'server'))
import event_api as api

class IdleTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.now=1795424400
        self.d=api.Director(self.temp.name,{'scheduled':False,'ownerUid':15155},lambda:self.now)
    def tearDown(self):self.d.db.close();self.temp.cleanup()
    def test_no_schedule_never_pins_starts_or_opens_signup(self):
        for n in range(3):
            self.d.game={'schema':1,'boot':str(n),'generatedAt':self.now*1000,'ack':0,'people':[]}
            Path(self.temp.name,'game.json').write_text(json.dumps(self.d.game))
            self.d.tick();self.now+=120
        view=self.d.index();control=json.loads(Path(self.temp.name,'control.json').read_text())
        self.assertIsNone(view['event']);self.assertEqual(view['phase'],'idle')
        self.assertEqual(view['upcoming'],[]);self.assertEqual(view['ongoing'],[])
        self.assertFalse(view['entriesOpen']);self.assertFalse(view['armed']);self.assertFalse(view['automatic'])
        self.assertFalse(control['active']);self.assertIsNone(control['pinTrack']);self.assertIsNone(control['countdownAt'])
        self.assertIsNone(control['action']);self.assertEqual(self.d.state['queue'],[])
        with self.assertRaises(ValueError):self.d.signup(dict(uid=5,name='Test',number='5'),'test')
    def test_saved_archive_survives_and_removed_event_is_missing(self):
        old=json.loads((ROOT/'reference/archived-event.json').read_text())['event']
        self.d.db.execute('INSERT INTO archives VALUES(?,?,?,?)',(old['event']['id'],old['event']['startsAt'],json.dumps(old),self.now));self.d.db.commit()
        self.assertEqual(len(self.d.index()['finished']),1)
        self.assertEqual(self.d.public_event(old['event']['id'])['motos'],old['motos'])
        self.assertIsNone(self.d.public_event('decker-fun-race-20261121'))
        self.assertIsNone(self.d.public_event('none'))
    def test_no_owner_command_can_rearm_deleted_event(self):
        for command in ('arm','grab','warmup','moto 1','auto on','pin on','resume','end'):
            with self.assertRaisesRegex(ValueError,'No event is scheduled'):self.d.command(command)
        with self.assertRaises(ValueError):self.d.owner_action(dict(requestId='idle-entry-1234',type='entry',uid=1,name='Test',number='1'))
        self.assertEqual(self.d.entries(),[])
    def test_normal_owner_server_tools_still_work(self):
        self.d.command('dashboard');self.assertIn('Private dashboard code:',self.d.state['notices'][-1]['text'])
        self.d.owner_action(dict(requestId='idle-erode-1234',type='erode',amount=1))
        self.assertEqual(self.d.state['queue'][-1]['commands'],['erode 1'])
        self.d.command('restart');self.assertEqual(self.d.state['queue'][-1]['commands'],['restart'])
        self.assertFalse(json.loads(Path(self.temp.name,'control.json').read_text())['active'])

if __name__=='__main__':unittest.main()
