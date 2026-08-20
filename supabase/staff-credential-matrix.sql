-- ============================================================
-- THE CREDENTIALING MATRIX
--
-- Everything this needs already exists: staff.credentials holds one row
-- per person per credential with an expiry, and
-- staff.job_credential_requirements says which kinds each job must
-- carry. What was missing is the shape an administrator actually reads —
-- a grid of people against credentials where the colour of a cell is the
-- whole answer.
--
-- THE ROW THAT MATTERS IS THE MISSING ONE. A per-person document shelf
-- shows what somebody HAS; it cannot show what they have not got, and
-- "the x-ray tech never uploaded an ARRT card" is precisely the finding a
-- surveyor writes up. So this starts from the REQUIREMENT and left-joins
-- the credential, not the other way round.
--
-- Ninety days because that is roughly a renewal cycle for BLS and ACLS:
-- long enough to book a class, short enough that the warning still means
-- something when it appears.
-- ============================================================

drop view if exists staff.credential_matrix cascade;
create view staff.credential_matrix
with (security_invoker = true) as
select
  u.org_slug,
  u.id                as user_id,
  u.name              as staff_name,
  u.legal_name,
  u.job_role,
  req.kind::text      as kind,
  coalesce(req.label, req.kind::text) as kind_label,
  req.required,
  req.sort_order,
  c.id                as credential_id,
  c.expires_on,
  (c.expires_on - current_date) as days_left,
  case
    when c.id is null                                      then 'missing'
    -- A credential with no expiry date is a credential nobody can
    -- evidence the currency of. Treated as present but unverifiable
    -- rather than silently counted as fine.
    when c.expires_on is null                              then 'undated'
    when c.expires_on < current_date                       then 'expired'
    when c.expires_on <= current_date + 90                 then 'expiring'
    else 'current'
  end as status
from staff.users u
join staff.job_credential_requirements req
  on req.org_slug = u.org_slug
 and req.job_role = u.job_role
 and req.active
left join lateral (
  -- The furthest-out valid card wins when somebody has renewed early and
  -- both the old and new are on file. Picking the newest by created_at
  -- would show the old one whenever the renewal was uploaded first.
  select c2.id, c2.expires_on
    from staff.credentials c2
   where c2.user_id = u.id
     and c2.kind = req.kind
     and c2.active
   order by c2.expires_on desc nulls last
   limit 1
) c on true
where u.active
  and u.job_role is not null;

grant select on staff.credential_matrix to staff_app;

-- The one number an owner wants without reading the grid.
drop view if exists staff.credential_gaps cascade;
create view staff.credential_gaps
with (security_invoker = true) as
select org_slug,
       count(*) filter (where status = 'expired'  and required) as expired_required,
       count(*) filter (where status = 'missing'  and required) as missing_required,
       count(*) filter (where status = 'expiring' and required) as expiring_required,
       count(*) filter (where status = 'undated'  and required) as undated_required
  from staff.credential_matrix
 group by org_slug;

grant select on staff.credential_gaps to staff_app;
