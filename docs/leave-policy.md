# Leave rules and their sources

The leave workflow checks a request before it starts, so a request that breaks a rule is
refused at the form instead of reaching an approver. Statutory rules come from the
Manpower Law (UU 13/2003, as amended by UU 6/2023 Cipta Kerja) and the Mother and Child
Welfare Law (UU 4/2024, KIA). Anything beyond those is marked as company policy and is
a setting, not a legal claim.

| Type | Length | Unit | Basis |
|---|---|---|---|
| Annual leave | 12 days a year, after 12 months' continuous service | working days | UU 13/2003 Pasal 79 as amended by UU 6/2023 |
| Own marriage | up to 3 | working days | UU 13/2003 Pasal 93(4)(a) |
| Marriage of a child | up to 2 | working days | Pasal 93(4)(b) |
| Child's circumcision or baptism | up to 2 | working days | Pasal 93(4)(c) and (d) |
| Accompanying a wife giving birth or miscarrying | 2, plus up to 3 more by agreement | working days | UU 4/2024 Pasal 6(2); UU 13/2003 Pasal 93(4)(e) |
| Death of a spouse, parent, parent-in-law, child or child-in-law | up to 2 | working days | Pasal 93(4)(f) |
| Death of a household member | 1 | working day | Pasal 93(4)(g) |
| Maternity | at least the first 3 months (90 days here) | calendar days | UU 13/2003 Pasal 82; UU 4/2024 |
| Sick leave | as needed, with a doctor's note | working days | UU 13/2003 Pasal 93(2)(a) |
| Unpaid leave | up to 30, always to the department head | working days | Company policy |

## Counting days

- Working days skip Saturdays, Sundays, national holidays and the 2026 cuti bersama days
  from SKB 3 Menteri No. 1497/2025, 2/2025 and 5/2025 (17 national holidays, 8 cuti bersama
  days). Admins can add later years' holidays on the Admin page.
- **Company policy:** Arunika Life closes on cuti bersama days and does not charge them to
  annual leave. Many employers do charge them; `makeCalendar(holidays, { observeCutiBersama })`
  is the switch for the office-closed part.
- Maternity leave counts calendar days, because it is a continuous absence.

## Balances

- **Company policy:** in the year the 12-month anniversary falls, annual leave is pro-rated
  by the whole months left after the anniversary month (anniversary in March gives 9 days).
- Requests still waiting for approval count against the balance, so two requests cannot
  spend the same days.
- Sick leave can be backdated by up to 14 days, bereavement by 7; other leave cannot start
  in the past.

## Approval routing

- Line manager first. If the manager has not acted within 16 working hours, the request goes
  to the manager's manager; a second miss sends it one level higher again.
- More than five working days, or any unpaid leave, also needs the department head, unless
  the line manager is the department head, in which case they are not asked twice.
- A rejection needs a reason, which the employee sees.
