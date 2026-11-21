import importlib.util,json,sys,tempfile,unittest,copy,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'server'))
import event_api as api


class FeatureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name)
        self.now=1795244400.0
        self.config=json.loads((ROOT/'server/event.json').read_text())
        self.d=api.Director(self.folder,self.config,lambda:self.now)
        self.game=dict(schema=1,generatedAt=self.now*1000,boot='one',ack=0,people=[],qualifying=[],race=None,
            catalog=[dict(dir='decker',file='/trackinfo/decker.trackinfo',minutes=0,laps=3,eventTrack=False),
                     dict(dir='Mintop',file='/trackinfo/Mintop.trackinfo',minutes=0,laps=4,eventTrack=False)])
        self.d.game=self.game
    def tearDown(self):self.d.db.close();self.temp.cleanup()
    def action(self,**data):return self.d.owner_action(dict(requestId='test-request-12345',**data))

    def test_archive_preserves_saved_results_separate_from_current(self):
        old=json.loads((ROOT/'reference/archived-event.json').read_text())['event']
        archived=copy.deepcopy(old);archived.update(archived=True,entriesOpen=False,live=False)
        self.d.db.execute('INSERT INTO archives VALUES(?,?,?,?)',(old['event']['id'],old['event']['startsAt'],json.dumps(archived),self.now));self.d.db.commit()
        index=self.d.index();self.assertEqual(len(index['upcoming']),1);self.assertEqual(len(index['finished']),1)
        self.assertEqual(index['upcoming'][0]['event']['trackDir'],'decker')
        previous=self.d.public_event(old['event']['id'])
        self.assertFalse(previous['entriesOpen']);self.assertEqual(previous['motos'],old['motos'])
        self.assertEqual(previous['overall'],old['overall']);self.assertEqual(len(previous['entries']),8)
        self.assertEqual(self.d.entries(),[])

    def test_deadline_exactly_closes_signups(self):
        self.now=self.d.deadline
        self.assertFalse(self.d.view()['entriesOpen'])
        with self.assertRaises(ValueError):self.d.signup(dict(uid=5,name='Late',number='5'),'test')

    def test_pair_code_private_single_use_and_revocation(self):
        self.d.command('dashboard')
        private=self.d.state['notices'][-1]['text'];code=re.search(r'\b\d{8}\b',private)[0]
        self.assertNotIn(code,json.dumps(self.d.index()))
        token,session=self.d.auth.login(code,'client')
        self.assertTrue(self.d.auth.session('317mx_owner='+token))
        with self.assertRaises(ValueError):self.d.auth.login(code,'client')
        self.d.command('dashboard logout');self.assertIsNone(self.d.auth.session('317mx_owner='+token))

    def test_auth_expiration_and_attempt_limit(self):
        code=self.d.auth.issue();self.now+=301
        with self.assertRaises(ValueError):self.d.auth.login(code,'client')
        for _ in range(5):
            with self.assertRaises(ValueError):self.d.auth.login('wrong','client')
        with self.assertRaisesRegex(ValueError,'Too many'):self.d.auth.login(self.d.auth.issue(),'client')

    def test_pinning_and_generic_decker_moto(self):
        control=json.loads((self.folder/'control.json').read_text())
        self.assertEqual(control['pinTrack'],'decker');self.assertFalse(control['active'])
        self.d.state['phase']='paused';self.d.state['roster']=[dict(uid=15155,name='Cody',number='317')]
        self.d.begin('moto1')
        commands=self.d.state['queue'][-1]['commands']
        self.assertIn('addtrack 15 1 -1 /trackinfo/decker.trackinfo',commands)
        self.assertNotIn('Mintop',' '.join(commands))
        with self.assertRaisesRegex(ValueError,'already pending'):self.d.begin('moto1')

    def test_owner_action_idempotency_and_whitelist(self):
        self.action(type='broadcast',message='Hello racers')
        count=len(self.d.state['queue'])
        self.action(type='broadcast',message='Hello racers')
        self.assertEqual(len(self.d.state['queue']),count)
        with self.assertRaises(ValueError):self.action(type='broadcast',message='Other message')
        with self.assertRaises(ValueError):self.d.owner_action(dict(requestId='different-12345',type='command',command='shutdown'))

    def test_owner_erode_entry_and_pin(self):
        self.action(type='erode',amount=3.5)
        self.assertEqual(self.d.state['queue'][-1]['commands'],['erode 3.5'])
        self.d.owner_action(dict(requestId='entry-owner-12345',type='entry',uid=100,name='<Rider>',number='99'))
        self.assertEqual(self.d.entries()[0]['name'],'<Rider>')
        self.d.command('pin off');self.assertFalse(self.d.state['pin'])
        self.d.command('pin on');self.assertTrue(self.d.state['pin'])


if __name__=='__main__':unittest.main(verbosity=2)
