import type { Role } from './roles.js';

// The fixed permission matrix (RBAC design review §2.2). Roles and permissions are code, not data:
// for a system this size a reviewed static matrix is safer than dynamic RBAC. A permission says what a
// role may do at all; WHICH teams/scenarios an instructor may do it to is decided separately by
// scope.ts on the row loaded from the DB.
export const PERMISSIONS = [
  // Organizations and registration
  'org.read',
  'org.manage', // create / rename / delete
  'registration.manage', // general and per-organization join codes
  // Staff accounts and their scope
  'account.manage',
  'assignment.manage',
  // Teams and students (instructor: within assigned organizations)
  'team.read',
  'team.manage', // create / delete / move between organizations
  'student.manage', // create / move / delete students, certificate grants
  'team.self', // a student's own team workspace (/teams/me/*)
  // Scenario progress and the live view
  'progress.manage', // assign / switch / complete a team's scenario
  'dashboard.read',
  // Team work product
  'documentation.read',
  'documentation.write',
  'documentation.feedback',
  'canvas.read',
  'canvas.write',
  'history.read',
  // Scoring
  'score.read',
  'score.award',
  'ttp.manage', // credit / void detections, read reports
  'ttp.occurrence.mark',
  'leaderboard.read',
  // Help and remote access
  'help.request',
  'help.manage',
  'access_session.self',
  'access_session.manage',
  // Scenario content (instructor: assigned scenarios; edits apply to every organization using them)
  'scenario.read', // catalog + (students) the published topology of an assigned scenario
  'scenario.inspect', // staff: draft topology, answer key, settings
  'scenario.create',
  'scenario.delete',
  'scenario.author',
  // Cloud environments and VMs
  'environment.manage', // register / delete / discover / link / secrets
  'environment.operate', // power, library scripts, Connect on in-scope nodes (exclusivity applies)
  'script.read',
  'script.write',
  'script.adhoc', // run arbitrary script content on a VM
  // System
  'audit.read',
  'event.reset',
  'event.export', // admin: the GLOBAL results export (every team)
  'results.export', // staff: results export limited to the caller's (organization, scenario) pairs
  'remote_access.revoke_all',
  'mitre.read',
  'profile.self',
  // AI Investigation Assessment: run and read AI assessments of in-scope team work (pair scope applies).
  // Uploading a scenario's ground-truth document uses scenario.author; the decision route also needs score.award.
  'ai_assessment.use',
  'ai_resources.manage', // admin: list / delete the app's Foundry files and vector stores (explicit cleanup only)
  'certificate.manage', // admin: the certificate library (texts shared by every scenario)
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const INSTRUCTOR: readonly Permission[] = [
  'org.read',
  'team.read',
  'team.manage',
  'student.manage',
  'progress.manage',
  'dashboard.read',
  'documentation.read',
  'documentation.feedback',
  'canvas.read',
  'history.read',
  'score.read',
  'score.award',
  'ttp.manage',
  'ttp.occurrence.mark',
  'leaderboard.read',
  'help.manage',
  'access_session.manage',
  'scenario.read',
  'scenario.inspect',
  'scenario.author',
  'environment.operate',
  'script.read',
  'audit.read',
  'mitre.read',
  'profile.self',
  'ai_assessment.use',
  'results.export',
];

const STUDENT: readonly Permission[] = [
  'team.self',
  'documentation.read',
  'documentation.write',
  'canvas.read',
  'canvas.write',
  'history.read',
  'leaderboard.read',
  'help.request',
  'access_session.self',
  'scenario.read',
  'mitre.read',
  'profile.self',
];

// Admin may do everything EXCEPT what only a team member can do (author a timeline, ask for help,
// open a student session) — those have no meaning for an account without a team.
const STUDENT_ONLY: readonly Permission[] = ['team.self', 'documentation.write', 'canvas.write', 'help.request', 'access_session.self'];

const instructorSet = new Set<Permission>(INSTRUCTOR);
const studentSet = new Set<Permission>(STUDENT);
const studentOnlySet = new Set<Permission>(STUDENT_ONLY);

export function can(role: Role, permission: Permission): boolean {
  switch (role) {
    case 'admin':
      return !studentOnlySet.has(permission);
    case 'instructor':
      return instructorSet.has(permission);
    case 'student':
      return studentSet.has(permission);
    default:
      return false;
  }
}

export function permissionsFor(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => can(role, p));
}
