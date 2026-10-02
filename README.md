# Heartland TV Basketball Scoreboard

A simple, CCX-inspired basketball scorebug designed for Heartland TV and YoloBox.

- `index.html` — transparent broadcast overlay
- `control.html` — operator controls

The design uses Heartland blue, white, and charcoal with a compact bottom-center layout.

## Important
This first static version stores state in the browser. The overlay and control page must run in the same browser/device profile to share live state. For control from a separate phone/laptop while YoloBox renders the overlay, add a small realtime backend (Firebase/Supabase/etc.) or connect scoreboard data directly.
