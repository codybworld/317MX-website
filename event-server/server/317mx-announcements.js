/* A mostly white, bordered welcome, once per rider per loaded race. */
(function () {
    var oldConnect=mxserver.connect_handler,oldDisconnect=mxserver.disconnect_handler;
    var oldStart=mxserver.start_handler,oldReady=mxserver.ready_handler;
    var race=0,delivered={};
    function repeat(c,n){var s='';while(n-->0)s+=c;return s;}
    function panel(){
        var lines=[],width=64,tracks=mxserver._317mx_rotation_tracks||[];
        function border(){lines.push('\x1b[0m+'+repeat('-',width+2)+'+');}
        function row(value,accent){
            var text=String(value).replace(/[^\x20-\x7e]/g,'?');
            while(text.length>width){row(text.substring(0,width),false);text=text.substring(width);}
            lines.push('\x1b[0m| '+(accent?'\x1b[33m':'')+text+'\x1b[0m'+repeat(' ',width-text.length)+' |');
        }
        border();row("* 317MX - CODY B'S SERVER *",true);border();
        row('Website: 317mx.duckdns.org');
        var meta=mxserver._317mx_event_meta||{};
        if(mxserver._317mx_event_pin){
            row('QUALIFYING TRACK: '+(meta.trackName||'Decker Training Facility'));
            row('Pinned for the upcoming event. Track votes are paused.');
            row(meta.title||'Decker Fun Race');
            row('Scheduled start: Nov 21 | 11:30 PM EST');
            row('Signups, qualifying and results: /events.html');
        }else{
            row('Mintop MX is the default outside scheduled events.');
            row('Track vote: server,callvote settrack #');
        }
        if(mxserver._317mx_event_active)row('Event in progress | Owner controls: server,event help');
        else row('Erode vote: server,callvote erode #');
        row('Track numbers: server,listtracks');
        border();row('* AVAILABLE TRACKS / INDIVIDUAL DOWNLOADS ON WEBSITE *');border();
        for(var i=0;i<tracks.length;i++)row(i+'. '+tracks[i].name);
        border();row('* SOCIALS / HELP *');border();
        row('Instagram: @317_mxsimulator');row('TikTok: @codybworld');
        row('Message me for suspension, setups and riding tips.');
        row('Download tracks: 317mx.duckdns.org in your browser');border();
        return lines;
    }
    mxserver.connect_handler=function(slot){if(typeof oldConnect==='function')oldConnect.apply(this,arguments);if(delivered[slot]&&delivered[slot].uid!==mxserver.get_uid(slot))delete delivered[slot];};
    mxserver.disconnect_handler=function(slot){delete delivered[slot];if(typeof oldDisconnect==='function')oldDisconnect.apply(this,arguments);};
    mxserver.start_handler=function(){race++;if(typeof oldStart==='function')oldStart.apply(this,arguments);};
    mxserver.ready_handler=function(slot){
        if(typeof oldReady==='function')oldReady.apply(this,arguments);
        var uid=mxserver.get_uid(slot),previous=delivered[slot];
        if(previous&&previous.uid===uid&&previous.race===race)return;
        var lines=panel();for(var i=0;i<lines.length;i++)mxserver.send(slot,lines[i]);
        delivered[slot]={uid:uid,race:race};
    };
    mxserver.log('317MX bordered white welcome enabled: one panel per loaded rider/race.\n');
}());
