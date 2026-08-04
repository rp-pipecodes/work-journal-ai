# Project narrows the Filter

The Filter is a day range plus an optional Project constraint (named Project, Unfiled, or Any). Project is a narrow on top of the day spine — standup is still day-shaped — unlike Search, which only moves the day axis and never matches Project names (ADR 0004). Default on open is Any so History never hides Notes unasked. A capture whose Project misses the constraint does not Nudge; only a Journal Day outside the range does — project mismatch is too common and too noisy to announce.
