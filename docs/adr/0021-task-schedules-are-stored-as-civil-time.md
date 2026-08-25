# Task schedules are stored as civil time

Scheduled For is stored as a local calendar date and optional minute-precise wall-clock time, with recurrence anchors preserved separately; a concrete delivery instant is derived only when registering a Task Alert. This makes “Monday at 14:00” remain 14:00 as the user travels and lets monthly and yearly rules recover their intended dates after shorter periods. Rejected: storing only a UTC instant or original timezone, either of which would shift the user's work schedule after travel and contradict the meaning presented by the Task Editor.
