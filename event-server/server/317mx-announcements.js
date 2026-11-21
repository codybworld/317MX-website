/* One welcome panel after each rider finishes loading a race.
 * Duplicate ready events in the same race never repeat the panel.
 */
(function () {
    var oldConnect = mxserver.connect_handler, oldDisconnect = mxserver.disconnect_handler;
    var oldStart = mxserver.start_handler, oldReady = mxserver.ready_handler;
    var race = 0, delivered = {};
    var colors = [32, 33, 31];

    function repeat(character, count) {
        var result = '';
        while (count-- > 0) result += character;
        return result;
    }
    function panel() {
        var lines = [], color = 0, tracks = mxserver._317mx_rotation_tracks || [];
        function add(text) {
            var gap = 64 - text.length;
            lines.push('\x1b[' + colors[color++ % 3] + 'm' +
                repeat('-', Math.floor(gap / 2)) + ' ' + text + ' ' +
                repeat('-', Math.ceil(gap / 2)) + '\x1b[0m');
        }
        add("Welcome to the 317MX (Cody B's) Server");
        add('Check out my website: 317mx.duckdns.org');
        if (mxserver._317mx_event_active) {
            add('TEST FUN RACE - MINTOP MX EVENT SESSION');
            add('Event lineup and results: /events.html');
            add('Track votes pause while the event is running');
        } else {
        add('CURRENT TRACKS - MINTOP MX IS THE DEFAULT');
        add('Voted track returns to Mintop on restart 3');
        add('Track numbers: server,listtracks');
        add('Track vote: server,callvote settrack #');
        add('Erode vote: server,callvote erode #');
        add('Vote yes: server,vote yes | No: server,vote no');
        }
        for (var i = 0; i < mxserver.get_number('track_count'); i++) {
            var file = mxserver.get_string('track_list', i);
            var id = file.split(/[\/\\]/).pop().replace(/\.trackinfo$/i, '');
            var name = id;
            for (var j = 0; j < tracks.length; j++) {
                if (tracks[j].id === id) { name = tracks[j].name; break; }
            }
            add(i + '. ' + name.replace(/[^\x20-\x7e]/g, '?').substring(0, 58));
        }
        add('Instagram: @317_mxsimulator');
        add('TikTok: @codybworld');
        add('Message me for suspension/setups and tips');
        add('Download all the tracks at 317mx.duckdns.org');
        add('in your browser');
        return lines;
    }
    mxserver.connect_handler = function (slot) {
        if (typeof oldConnect === 'function') oldConnect.apply(this, arguments);
        if (delivered[slot] && delivered[slot].uid !== mxserver.get_uid(slot)) delete delivered[slot];
    };
    mxserver.disconnect_handler = function (slot) {
        delete delivered[slot];
        if (typeof oldDisconnect === 'function') oldDisconnect.apply(this, arguments);
    };
    mxserver.start_handler = function () {
        race++;
        if (typeof oldStart === 'function') oldStart.apply(this, arguments);
    };
    mxserver.ready_handler = function (slot) {
        if (typeof oldReady === 'function') oldReady.apply(this, arguments);
        var uid = mxserver.get_uid(slot), previous = delivered[slot];
        if (previous && previous.uid === uid && previous.race === race) return;
        var lines = panel();
        for (var i = 0; i < lines.length; i++) mxserver.send(slot, lines[i]);
        delivered[slot] = {uid: uid, race: race};
        mxserver.log('317MX welcome delivered after loading: slot ' + slot + ', race ' + race + '.\n');
    };
    mxserver.log('317MX welcome panel enabled: once after loading on join and after each race restart.\n');
}());
