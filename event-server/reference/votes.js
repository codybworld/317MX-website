/* Native callvote/vote workflow, integrated with durable rotation state.
 * A verified Player/Spectator may vote once per UID. Strict majority wins.
 */
(function () {
    var previous = mxserver.command_handler, current = null, sequence = 0;
    function eligible(slot) {
        var status = mxserver.get_status(slot);
        return mxserver.get_uid(slot) > 0 && (status === 'Player' || status === 'Spectator');
    }
    function tally(final) {
        var seen = {}, total = 0, yes = 0, no = 0;
        for (var i = 0; i < mxserver.max_slots; i++) {
            var uid = mxserver.get_uid(i);
            if (!eligible(i) || seen[uid]) continue;
            seen[uid] = true; total++;
            if (current.votes[uid] === true) yes++;
            if (current.votes[uid] === false) no++;
        }
        mxserver.broadcast('Vote tally: ' + yes + ' yes, ' + no + ' no, ' + (total - yes - no) + ' abstain.');
        if (yes * 2 > total) {
            var result = mxserver._317mx_apply_vote(current.action);
            mxserver.broadcast(result ? 'Vote passed but could not be applied: ' + result :
                'Vote succeeded! Setting applies on the next race restart.');
            current = null;
        } else if (no * 2 > total || final) {
            mxserver.broadcast('Vote failed.'); current = null;
        }
    }
    mxserver.command_handler = function (slot, command) {
        var match = /^\s*(callvote|vote|endvote)\b\s*(.*?)\s*$/.exec(command);
        if (!match) return typeof previous === 'function' ? previous.apply(this, arguments) : 0;
        var type = match[1], value = match[2];
        if (type === 'endvote') {
            if (slot === mxserver.max_slots && current && value === String(current.id)) tally(true);
            return 1;
        }
        if (slot < 0 || slot >= mxserver.max_slots || !eligible(slot)) {
            mxserver.send(slot, 'A verified, connected rider or spectator is required to vote.'); return 1;
        }
        var uid = mxserver.get_uid(slot);
        if (type === 'vote') {
            if (!current) mxserver.send(slot, 'No vote in progress.');
            else if (!/^(yes|no|aye|nay)$/.test(value)) mxserver.send(slot, 'Usage: server,vote yes or server,vote no');
            else {
                current.votes[uid] = /^(yes|aye)$/.test(value);
                tally(false);
            }
            return 1;
        }
        if (current) { mxserver.send(slot, 'Vote already in progress.'); return 1; }
        var normalized = /^(settrack|erode)\s+(\S+)$/.exec(value);
        if (!normalized) { mxserver.send(slot, 'Use server,callvote settrack # or server,callvote erode #.'); return 1; }
        var action = mxserver._317mx_prepare_vote(normalized[1] + ' ' + normalized[2]);
        if (action.error) { mxserver.send(slot, action.error); return 1; }
        current = {id: ++sequence, action: action, votes: {}};
        current.votes[uid] = true;
        mxserver.broadcast(mxserver.get_slot_info(slot).name + ' called a vote: ' + value +
            (action.track ? ' (' + action.track.name + ')' : '') +
            '. Type server,vote yes or server,vote no. Voting lasts up to 60 seconds.');
        mxserver.schedule_command('at +60 endvote ' + current.id);
        tally(false);
        return 1;
    };
    mxserver.log('317MX public track and erode voting enabled.\n');
}());
