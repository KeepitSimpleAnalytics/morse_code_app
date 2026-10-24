-- Schema version 2. Lets per-mode event reads (ICR's median over its newest
-- answers) walk an index in time order instead of scanning every event.

CREATE INDEX idx_char_events_profile_mode_ts ON char_events(profile_id, mode, ts);
