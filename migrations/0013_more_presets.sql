-- More well-established hangboard protocols as timer presets (#59). Additive: a preset is only inserted
-- when none with that name exists, so edited or user-made presets are never overwritten or duplicated.
-- They sort after whatever presets exist already, in this order.
INSERT INTO timer_presets (name, prep_s, on_s, off_s, reps, sets, set_rest_s, edge_mm, grip, added_kg, notes, sort)
SELECT p.name, p.prep_s, p.on_s, p.off_s, p.reps, p.sets, p.set_rest_s, p.edge_mm, p.grip, p.added_kg, p.notes,
       (SELECT COALESCE(MAX(sort), 0) FROM timer_presets) + p.n
FROM (
  SELECT 1 AS n, '7/53' AS name, 10 AS prep_s, 7 AS on_s, 53 AS off_s, 3 AS reps, 3 AS sets, 180 AS set_rest_s,
         20 AS edge_mm, 'half crimp' AS grip, 0 AS added_kg,
         'Eric Hörst. Add weight so each 7 s hang is hard but you could hold about 3 s more. Drop the last set if the hangs fall apart. Stop if anything feels sharp.' AS notes
  UNION ALL SELECT 2, 'MinEdge hangs', 10, 10, 120, 5, 1, 0, 14, 'half crimp', 0,
         'Eva López. Bodyweight on the smallest edge you can hold for about 12 s, so the 10 s hang leaves 1-2 s spare. Go up an edge size if you can''t. Stop if anything feels sharp.'
  UNION ALL SELECT 3, 'Intermittent hangs', 10, 10, 5, 5, 4, 60, 20, 'half crimp', 0,
         'Eva López IntHangs, strength-endurance. 10 on / 5 off x5 = one set. Pick an edge or load where the last hang of each set is hard but clean. Not the day after hard bouldering.'
  UNION ALL SELECT 4, 'Density hangs', 10, 30, 90, 4, 1, 0, 20, 'open hand', 0,
         'Long submaximal hangs for tendon strength, popularised by Tyler Nelson. Use a load you could hold about 10 s longer than the 30 s hang; keep your feet on to unload if needed.'
) AS p
WHERE NOT EXISTS (SELECT 1 FROM timer_presets t WHERE lower(t.name) = lower(p.name));
