"""Owner dashboard authentication: short-lived in-game pairing, hashed sessions."""
import hashlib
import hmac
from http.cookies import SimpleCookie,CookieError
import re
import secrets


class OwnerAuth:
    def __init__(self,db,clock):
        self.db,self.clock=db,clock
        self.attempts={}; self.global_attempts=[]
        db.executescript('''
          CREATE TABLE IF NOT EXISTS owner_codes(digest TEXT PRIMARY KEY,expires REAL);
          CREATE TABLE IF NOT EXISTS owner_sessions(digest TEXT PRIMARY KEY,csrf TEXT,expires REAL);
        ''')

    @staticmethod
    def digest(value):return hashlib.sha256(value.encode('ascii')).hexdigest()

    def issue(self):
        code='%08d'%secrets.randbelow(100000000)
        self.db.execute('DELETE FROM owner_codes')
        self.db.execute('INSERT INTO owner_codes VALUES(?,?)',(self.digest(code),self.clock()+300))
        self.db.commit()
        return code

    def login(self,code,ip):
        now=self.clock()
        self.global_attempts=[t for t in self.global_attempts if now-t<300]
        local=[t for t in self.attempts.get(ip,[]) if now-t<300]
        if len(local)>=6 or len(self.global_attempts)>=30:
            raise ValueError('Too many attempts. Wait five minutes and request a new in-game code.')
        self.attempts[ip]=local+[now];self.global_attempts.append(now)
        if len(self.attempts)>2000:self.attempts={k:v for k,v in self.attempts.items() if v and now-v[-1]<300}
        if not isinstance(code,str) or not re.fullmatch(r'\d{8}',code):
            raise ValueError('Enter the eight-digit code from server,event dashboard.')
        found=self.db.execute('SELECT digest,expires FROM owner_codes').fetchone()
        if not found or found['expires']<now or not hmac.compare_digest(found['digest'],self.digest(code)):
            raise ValueError('Code expired or incorrect. Request a new code in game.')
        token,csrf=secrets.token_urlsafe(32),secrets.token_urlsafe(32)
        expires=now+7*86400
        self.db.execute('DELETE FROM owner_codes')
        self.db.execute('DELETE FROM owner_sessions WHERE expires<?',(now,))
        self.db.execute('INSERT INTO owner_sessions VALUES(?,?,?)',(self.digest(token),csrf,expires))
        self.db.commit()
        return token,dict(csrf=csrf,expires=expires)

    def session(self,header):
        try:
            cookie=SimpleCookie();cookie.load(header or '')
            token=cookie['317mx_owner'].value
            if not re.fullmatch(r'[A-Za-z0-9_-]{43}',token):return None
            digest=self.digest(token)
            found=self.db.execute('SELECT csrf,expires FROM owner_sessions WHERE digest=?',(digest,)).fetchone()
            if found and found['expires']>self.clock():return dict(found,digest=digest)
        except (KeyError,ValueError,TypeError,CookieError):pass
        return None

    def revoke(self,digest=None):
        if digest:self.db.execute('DELETE FROM owner_sessions WHERE digest=?',(digest,))
        else:self.db.execute('DELETE FROM owner_sessions');self.db.execute('DELETE FROM owner_codes')
        self.db.commit()
