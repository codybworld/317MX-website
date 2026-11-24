"""Event archives and the authenticated dashboard's bounded operation set."""
import copy
from datetime import datetime
import hashlib
import json
import re
from owner_auth import OwnerAuth


class EventFeatures:
    def init_features(self):
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS archives(id TEXT PRIMARY KEY,starts_at TEXT,view TEXT,archived_at REAL);
          CREATE TABLE IF NOT EXISTS owner_actions(id TEXT PRIMARY KEY,fingerprint TEXT,command TEXT,at REAL,result TEXT);
        ''')
        self.auth=OwnerAuth(self.db,self.clock)
        if self.state.get('eventId',self.config['id'])!=self.config['id']:
            raise ValueError('Event ID changed without an archive migration')
        self.state['eventId']=self.config['id']
        self.state.setdefault('pin',self.config.get('pinTrack',False))

    @staticmethod
    def summary(view):
        event=view['event']
        return dict(event=event,phase=view['phase'],entriesOpen=view.get('entriesOpen',False),
            entryCount=len(view.get('entries',[])),overallFinal=view.get('overallFinal',False),
            archived=view.get('archived',False))

    def index(self):
        with self.lock:
            current=self.view()
            finished=[self.summary(json.loads(row['view'])) for row in self.db.execute('SELECT view FROM archives ORDER BY starts_at DESC')]
            upcoming=[];ongoing=[]
            if not self.scheduled:
                return dict(current,event=None,upcoming=[],ongoing=[],finished=finished)
            if current['phase'] in ('complete','cancelled'):
                finished.insert(0,self.summary(current))
            elif self.clock()<self.deadline:upcoming.append(self.summary(current))
            else:ongoing.append(self.summary(current))
            return dict(current,upcoming=upcoming,ongoing=ongoing,finished=finished)

    def public_event(self,event_id):
        if self.scheduled and event_id==self.config['id']:return self.view()
        row=self.db.execute('SELECT view FROM archives WHERE id=?',(event_id,)).fetchone()
        if not row:return None
        view=json.loads(row['view'])
        view.update(entriesOpen=False,archived=True,live=False,armed=False,automatic=False)
        return view

    def owner_view(self):
        with self.lock:
            return dict(event=self.view(),players=(self.game or {}).get('people',[]) if self.fresh() else [],
                race=(self.game or {}).get('race'),erode=(self.game or {}).get('erode'),
                pin=self.state['pin'],nativeError=(self.game or {}).get('nativeError'),pending=len(self.state['queue']),ack=(self.game or {}).get('ack',0),
                actions=[dict(id=r['id'],command=r['command'],at=r['at'],**json.loads(r['result'])) for r in
                    self.db.execute('SELECT * FROM owner_actions ORDER BY at DESC LIMIT 15')])

    def owner_action(self,value):
        if not isinstance(value,dict):raise ValueError('Invalid action')
        request_id=value.get('requestId')
        if not isinstance(request_id,str) or not re.fullmatch(r'[A-Za-z0-9-]{8,80}',request_id):
            raise ValueError('A unique request ID is required')
        fingerprint=hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
        previous=self.db.execute('SELECT * FROM owner_actions WHERE id=?',(request_id,)).fetchone()
        if previous:
            if previous['fingerprint']!=fingerprint:raise ValueError('Request ID was reused for another action')
            return json.loads(previous['result'])
        before=copy.deepcopy(self.state)
        verb=value.get('type')
        try:
            if verb=='command':
                command=value.get('command','')
                if not isinstance(command,str) or not re.fullmatch(r'(?:help|status|arm|disarm|grab|warmup|next|pause|resume|finish|rerun|end|restart|moto [12]|auto (?:on|off)|pin (?:on|off)|(?:add|remove) [1-9][0-9]{0,7}|result [12] [1-9][0-9]{0,7} (?:[1-9]|[1-3][0-9]|4[01]))',command):
                    raise ValueError('Unsupported event command')
                self.command(command)
            elif verb=='erode':
                amount=value.get('amount')
                if isinstance(amount,bool) or not isinstance(amount,(float,int)) or not 0<=amount<=100:
                    raise ValueError('Erode must be between 0 and 100')
                command='erode '+str(amount)
                self.action([command])
            elif verb=='broadcast':
                message=value.get('message')
                if not isinstance(message,str) or not message.strip() or len(message)>140 or any(ord(c)<32 or ord(c)==127 for c in message):
                    raise ValueError('Use one plain-text line, up to 140 characters')
                command='announcement'
                self.say(message.strip())
            elif verb=='entry':
                if not self.scheduled:raise ValueError('No event is scheduled. Event entries are closed.')
                uid=str(value.get('uid',''));number=str(value.get('number',''));name=value.get('name')
                if not re.fullmatch(r'[1-9][0-9]{0,7}',uid) or not re.fullmatch(r'\d{1,4}',number) or not isinstance(name,str) or not name.strip() or len(name)>70 or any(ord(c)<32 for c in name):
                    raise ValueError('Enter a name, numeric UID and race number')
                entry=self.db.execute('SELECT created FROM entries WHERE uid=?',(int(uid),)).fetchone()
                self.db.execute('INSERT OR REPLACE INTO entries VALUES(?,?,?,?)',(int(uid),name.strip(),number,entry[0] if entry else self.clock()))
                command='owner signup '+uid
            else:raise ValueError('Unknown action')
            self.save()
        except ValueError:
            self.state=before
            raise
        result=dict(ok=True,nativeAction=self.state['actionSeq'],queued=bool(self.state['queue']))
        self.db.execute('INSERT INTO owner_actions VALUES(?,?,?,?,?)',(request_id,fingerprint,command,self.clock(),json.dumps(result)))
        self.db.commit()
        return result
