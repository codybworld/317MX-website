/* Scoring functions from the official MX Simulator race analysis.
 * Source https://servers.mxsimulator.com/racestats.js, retrieved 2026-11-19.
 * Private scope keeps the original calculation independent of other scripts.
 */
var mx317RaceScoring = (function () {
var g_steps_per_second = 128;
function position_to_lap(raceinfo, p) {
	if (p < raceinfo.firstlap)
		return 0

	return 1 + Math.floor((p - raceinfo.firstlap) / raceinfo.normallap);
}

function lap_to_timeidx(raceinfo, lap) {
	if (lap == 0)
		return 0

	return raceinfo.firstlap + raceinfo.normallap * (lap - 1) - 1
}

function wrap_timing_position(raceinfo, i) {
	if (i < raceinfo.firstlap)
		return i

	return raceinfo.firstlap + (i - raceinfo.firstlap) % raceinfo.normallap
}

function get_section_time(times, i0, i1) {
	var i, t0, t1

	for (i = i0 < 0 ? 0 : i0; i <= i1; i++)
		if (!(i in times))
			return -1

	t0 = (i0 < 0) ? 0 : times[i0]
	t1 = times[i1]

	return t1 - t0;
}

function get_average_section_time(raceinfo, times, i0, i1) {
	var i, n, t, s, p, fll, nll

	p = times.length
	fll = raceinfo.firstlap
	nll = raceinfo.normallap

	if (i0 < fll)
		return get_section_time(times, i0, i1);

	t = 0
	n = 0
	i = wrap_timing_position(raceinfo, i0)

	for (i = wrap_timing_position(raceinfo, i0); i + (i1 - i0) < p; i += nll) {
		s = get_section_time(times, i, i + (i1 - i0));

		if (s >= 0) {
			t += s
			n++
		}
	}

	if (n == 0)
		return -1

	return Math.floor(t / n)
}

function get_baseline_section_time(raceinfo, index, i0, i1) {
	var i, s, t, n, times

        t = 0;
        n = 0;

        for (i in raceinfo.players) {
		times = raceinfo.players[i].times

		s = get_average_section_time(raceinfo, times, i0, i1)

		if (s >= 0) {
			t += s
			n++
		}
	}

	if (n == 0)
		return g_steps_per_second

        return Math.floor(t / n)
}

function get_cutting_penalty(raceinfo, index) {
	var times, i, n, r, p, t, t1, t0

	times = raceinfo.players[index].times
	n = times.length
	p = 0
	r = 0
	t0 = 0

	for (i = 0; i < n; i++) {
		if (!(i in times))
			r++
		else {
			t1 = times[i]
			if (r > 0) {
				t = get_baseline_section_time(raceinfo, index, i - r - 1, i)

				if (t + g_steps_per_second > t1 - t0)
					p += t + g_steps_per_second - (t1 - t0)

				r = 0
			}
			t0 = t1
		}
	}

	return p
}

function get_lap_time(raceinfo, times, lap) {
	var lastlap, lapstart, lapend

	lastlap = position_to_lap(raceinfo, times.length);

	if (lap < 0)
		lap = lastlap;

	if (lap < 1 || lap > lastlap)
		return 0

	lapstart = lap_to_timeidx(raceinfo, lap - 1)
	lapend = lap_to_timeidx(raceinfo, lap)

	if (!(lapstart in times && lapend in times))
		return 0

	if (lap == 1)
		lapstart = raceinfo.starttime;
	else
		lapstart = times[lapstart];
	lapend = times[lapend];

	return (lapend - lapstart)
}

function lap_no_cuts(raceinfo, times, lap) {
	var i, lapstart, lapend

	lapstart = lap_to_timeidx(raceinfo, lap - 1)
	lapend = lap_to_timeidx(raceinfo, lap)

	for (i = lapstart; i <= lapend; i++)
		if (!(i in times))
			return 0

	return 1
}

function best_lap(raceinfo, times, nocuts) {
	var i, j, n, best, t0, t1;

	n = position_to_lap(raceinfo, times.length)

	if (n < 2)
		return 0

	best = 2;

	for (i = 3; i <= n; i++)  {
		t0 = get_lap_time(raceinfo, times, best)
		t1 = get_lap_time(raceinfo, times, i)

		if (nocuts) {
			if (!lap_no_cuts(raceinfo, times, i))
				continue
			if (!lap_no_cuts(raceinfo, times, best))
				t0 = 0.0
		}

		if (t0 == 0.0 || (t1 != 0.0 && t1 < t0))
			best = i
	}

	if (nocuts && !lap_no_cuts(raceinfo, times, best))
		return 0

	return best
}

function best_time_to_lap(raceinfo, lap) {
	var i, ti, t, p, btime

	btime = 0

	ti = lap_to_timeidx(raceinfo, lap)

	for (i in raceinfo.players) {
		p = raceinfo.players[i]

		if (!(ti in p.times))
			continue

		t = p.times[ti]

		if (btime == 0 || t < btime)
			btime = t
	}

	return btime
}

function first_checkered_time(raceinfo) {
	var i, p, t, l, btime, laps

	btime = 0
	laps = 0

	if (raceinfo.time > 0) {
		for (laps = 1; ; laps++) {
			t = best_time_to_lap(raceinfo, laps)

			if (t == 0)
				return 0;
			else if (t >= raceinfo.time + raceinfo.starttime)
				break;
		}
	}

	laps += raceinfo.laps

	for (i in raceinfo.players) {
		p = raceinfo.players[i]

		l = position_to_lap(raceinfo, p.times.length)

		if (l < laps)
			continue

		t = p.times[lap_to_timeidx(raceinfo, laps)]

		if (btime == 0 || t < btime)
			btime = t;
	}

	return btime
}

function remove_lagger_bonus_laps(raceinfo) {
	var i, p, l, n, fct, t

	fct = raceinfo.firstcheckeredtime

	if (fct == 0)
		return

	for (i in raceinfo.players) {
		p = raceinfo.players[i]
		n = position_to_lap(raceinfo, p.times.length)
		for (l = 1; l <= n; l++) {
			t = lap_to_timeidx(raceinfo, l)
			if (p.times[t] > fct && p.times.length > t + 1)
				p.times.splice(t + 1, p.times.length - (t + 1))
		}
	}	
}

function compare_position_and_time(a, b) {
	if (a.position == b.position)
		return a.time - b.time
	return -(a.position - b.position)
}

function update_running_order(raceinfo) {
	var i, n, order, p, pos, time, penalty, bl

	n = 0
	order = []

	raceinfo.firstcheckeredtime = first_checkered_time(raceinfo)

	remove_lagger_bonus_laps(raceinfo)

	for (i in raceinfo.players) {
		p = raceinfo.players[i]

		pos = p.times.length

		pos = lap_to_timeidx(raceinfo, position_to_lap(raceinfo, pos)) + 1

		if (pos <= 1)
			time = raceinfo.starttime
		else
			time = p.times[pos - 1]

		penalty = get_cutting_penalty(raceinfo, i)

		bl = best_lap(raceinfo, p.times, false)

		if (bl >= 2) {
			bl = get_lap_time(raceinfo, p.times, bl)

			while (penalty > bl && pos > raceinfo.firstlap) {
				penalty -= bl
				pos -= raceinfo.normallap
			}
		}

		time += penalty

		order[n] = { index: i, position: pos, time: time }
		n++
	}

	order.sort(compare_position_and_time)

	raceinfo.order = order

	for (i in raceinfo.order)
		raceinfo.players[raceinfo.order[i].index].order = i
}


function score(race) {
    // Official scoring trims laps after a rider's checkered flag.
    // Clone sparse timing arrays so that live timing keeps its full history.
    var copy = {firstlap: race.firstlap, normallap: race.normallap,
        time: race.time, laps: race.laps, starttime: race.starttime, players: []};
    for (var slot in race.players) {
        var player = race.players[slot];
        copy.players[slot] = {uid: player.uid, name: player.name, times: player.times.slice()};
    }
    update_running_order(copy);
    return copy;
}
return {score: score, finishIndex: lap_to_timeidx, cleanLap: lap_no_cuts,
    lapTime: get_lap_time, completedLaps: position_to_lap};
}());
