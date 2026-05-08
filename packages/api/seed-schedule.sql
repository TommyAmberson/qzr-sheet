-- Seed a representative schedule slice for the local Test meet (id=1).
-- Idempotent: clears any existing schedule rows for this meet first.
-- Times are stored as Unix seconds; UTC strings here = America/Winnipeg
-- wall time + 6h (CST). Adjust if testing in another zone.

DELETE FROM scheduled_quiz_seats WHERE quiz_id IN (SELECT id FROM scheduled_quizzes WHERE meet_id = 1);
DELETE FROM scheduled_quizzes WHERE meet_id = 1;
DELETE FROM meet_slots WHERE meet_id = 1;
DELETE FROM meet_rooms WHERE meet_id = 1;

-- ---- Rooms ----
INSERT INTO meet_rooms (meet_id, name, sort_order) VALUES
  (1, 'Room 1', 1),
  (1, 'Room 2', 2),
  (1, 'Room 3', 3),
  (1, 'Room 4', 4),
  (1, 'Room 5', 5);

-- ---- Slots ----
-- Friday 2026-05-15 morning: assembly + 3 prelim rounds
-- Saturday 2026-05-16: stats break, intermediates, finals, awards
INSERT INTO meet_slots (meet_id, start_at, duration_minutes, kind, event_label, sort_order) VALUES
  (1, CAST(strftime('%s', '2026-05-15 13:30:00') AS INTEGER), 30, 'event', 'Opening Assembly',    1),
  (1, CAST(strftime('%s', '2026-05-15 14:00:00') AS INTEGER), 25, 'quiz',  NULL,                  2),
  (1, CAST(strftime('%s', '2026-05-15 14:25:00') AS INTEGER), 25, 'quiz',  NULL,                  3),
  (1, CAST(strftime('%s', '2026-05-15 14:50:00') AS INTEGER), 25, 'quiz',  NULL,                  4),
  (1, CAST(strftime('%s', '2026-05-16 15:00:00') AS INTEGER), 60, 'event', 'Stats Break',         5),
  (1, CAST(strftime('%s', '2026-05-16 16:00:00') AS INTEGER), 30, 'quiz',  NULL,                  6),
  (1, CAST(strftime('%s', '2026-05-16 17:00:00') AS INTEGER), 30, 'quiz',  NULL,                  7),
  (1, CAST(strftime('%s', '2026-05-16 22:00:00') AS INTEGER), 60, 'event', 'Awards & Worship',    8);

-- ---- Quizzes ----
-- Helper: slots and rooms looked up by sort_order / name within meet.
-- Round 1 (sort_order=2): full row
INSERT INTO scheduled_quizzes (meet_id, slot_id, room_id, division, phase, label) VALUES
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=2), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 1'), '1', 'prelim', 'Div 1 Quiz 1'),
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=2), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 2'), '1', 'prelim', 'Div 1 Quiz 2'),
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=2), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 3'), '1', 'prelim', 'Div 1 Quiz 3'),
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=2), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 4'), '2', 'prelim', 'Div 2 Quiz 1');
-- Round 2 (sort_order=3)
INSERT INTO scheduled_quizzes (meet_id, slot_id, room_id, division, phase, label) VALUES
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=3), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 1'), '1', 'prelim', 'Div 1 Quiz 4'),
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=3), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 2'), '1', 'prelim', 'Div 1 Quiz 5'),
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=3), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 3'), '1', 'prelim', 'Div 1 Quiz 6'),
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=3), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 4'), '2', 'prelim', 'Div 2 Quiz 2');
-- Round 3 (sort_order=4) — sparse: rooms 4 and 5 empty
INSERT INTO scheduled_quizzes (meet_id, slot_id, room_id, division, phase, label) VALUES
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=4), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 1'), '1', 'prelim', 'Div 1 Quiz 7'),
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=4), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 2'), '1', 'prelim', 'Div 1 Quiz 8'),
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=4), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 3'), '1', 'prelim', 'Div 1 Quiz 9');
-- Intermediates (sort_order=6) — elim with seedRefs
INSERT INTO scheduled_quizzes (meet_id, slot_id, room_id, division, phase, lane, label, bracket_label) VALUES
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=6), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 1'), '1', 'elim', 'intermediate', 'Div 1 Quiz X', 'X'),
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=6), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 2'), '1', 'elim', 'intermediate', 'Div 1 Quiz Y', 'Y'),
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=6), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 3'), '2', 'elim', 'intermediate', 'Div 2 Quiz X', 'X');
-- Finals (sort_order=7) — elim main
INSERT INTO scheduled_quizzes (meet_id, slot_id, room_id, division, phase, lane, label, bracket_label) VALUES
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=7), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 1'), '1', 'elim', 'main', 'Div 1 Final', 'Final'),
  (1, (SELECT id FROM meet_slots WHERE meet_id=1 AND sort_order=7), (SELECT id FROM meet_rooms WHERE meet_id=1 AND name='Room 2'), '2', 'elim', 'main', 'Div 2 Final', 'Final');

-- ---- Seats ----
-- Prelim seats: letter codes A–I across the 9 div-1 prelim quizzes per
-- rules.md "Preliminary Round Brackets" 9-team table.
-- Div 2 uses a 4-team table (A–F across 2 quizzes shown here).
INSERT INTO scheduled_quiz_seats (quiz_id, seat_number, letter) VALUES
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 1'), 1, 'A'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 1'), 2, 'B'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 1'), 3, 'C'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 2'), 1, 'D'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 2'), 2, 'E'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 2'), 3, 'F'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 3'), 1, 'G'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 3'), 2, 'H'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 3'), 3, 'I'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 4'), 1, 'A'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 4'), 2, 'D'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 4'), 3, 'G'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 5'), 1, 'B'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 5'), 2, 'E'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 5'), 3, 'H'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 6'), 1, 'C'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 6'), 2, 'F'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 6'), 3, 'I'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 7'), 1, 'A'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 7'), 2, 'E'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 7'), 3, 'I'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 8'), 1, 'B'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 8'), 2, 'F'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 8'), 3, 'G'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 9'), 1, 'C'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 9'), 2, 'D'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz 9'), 3, 'H'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Quiz 1'), 1, 'A'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Quiz 1'), 2, 'B'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Quiz 1'), 3, 'C'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Quiz 2'), 1, 'D'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Quiz 2'), 2, 'E'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Quiz 2'), 3, 'F');

-- Elim seats: seedRefs reference prior quizzes (X/Y) or prelim ranks.
INSERT INTO scheduled_quiz_seats (quiz_id, seat_number, seed_ref) VALUES
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz X'), 1, '7th place'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz X'), 2, '8th place'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz X'), 3, '9th place'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz Y'), 1, '10th place'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz Y'), 2, '11th place'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Quiz Y'), 3, '12th place'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Quiz X'), 1, '4th place'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Quiz X'), 2, '5th place'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Quiz X'), 3, '6th place'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Final'),  1, '1st Quiz X'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Final'),  2, '1st Quiz Y'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 1 Final'),  3, '1st of prelims'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Final'),  1, '1st Quiz X'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Final'),  2, '2nd Quiz X'),
  ((SELECT id FROM scheduled_quizzes WHERE meet_id=1 AND label='Div 2 Final'),  3, '3rd Quiz X');
