-- Media control on macOS. Takes one word, from the fixed vocabulary in
-- media.js, as an argument - never as an interpolated string, because a script
-- assembled from a variable is a script somebody else can finish writing.
--
-- This is NOT the same thing media.ps1 does, and the difference is worth
-- knowing. Windows broadcasts a virtual media key, which whatever is playing
-- picks up. macOS has no equivalent a script can send, so:
--
--   * volume and mute are system wide and behave exactly like Windows
--   * play, pause, next and previous are sent to Music or Spotify if one of
--     them is running, and to nothing at all if neither is
--
-- So the pet can turn a browser video down but cannot skip its track. That is a
-- real limit of the platform rather than an unfinished bit of this file.

on run argv
	if (count of argv) is 0 then error "no key given" number 2
	set theKey to item 1 of argv

	if theKey is "volup" then
		set volume output volume ((output volume of (get volume settings)) + 10)
	else if theKey is "voldown" then
		set volume output volume ((output volume of (get volume settings)) - 10)
	else if theKey is "mute" then
		set volume output muted not (output muted of (get volume settings))
	else
		set target to my playingApp()
		if target is "" then error "nothing is playing that I can reach" number 3
		if theKey is "playpause" then
			tell application target to playpause
		else if theKey is "next" then
			tell application target to next track
		else if theKey is "prev" then
			tell application target to previous track
		else if theKey is "stop" then
			tell application target to pause
		else
			error "unknown key" number 4
		end if
	end if
end run

-- Whichever of the two is actually running. Asked with `is running` rather than
-- by name so this never launches a music player the person did not open, which
-- would be a startling answer to "next track".
on playingApp()
	tell application "System Events"
		if (exists process "Music") then return "Music"
		if (exists process "Spotify") then return "Spotify"
	end tell
	return ""
end playingApp
