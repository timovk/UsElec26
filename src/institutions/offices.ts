/** Display labels of office kinds, shared by the engine's news and queries and the UI. */
import type { OfficeKind } from './model';

/** Short label of a contest's office (results tables and filters). */
export const OFFICE_LABEL: Record<string, string> = {
  president: 'President', vice_president: 'Vice President', us_senator: 'U.S. Senate', us_representative: 'U.S. House',
  governor: 'Governor', lt_governor: 'Lt. Governor', attorney_general: 'Attorney General', secretary_of_state: 'Secretary of State',
  state_senator: 'State Senate', state_representative: 'State House',
  treasurer: 'Treasurer', auditor: 'Auditor / Comptroller', superintendent: 'Superintendent', insurance_commissioner: 'Insurance Commissioner',
  agriculture_commissioner: 'Agriculture Commissioner', labor_commissioner: 'Labor Commissioner', land_commissioner: 'Land Commissioner',
  other_statewide: 'Other statewide office', commissioner: 'Commissions', education_board: 'Boards of education', regent: 'University boards',
  justice: 'Supreme Court', appellate_judge: 'Court of Appeals',
};

/** Groups of office kinds for filters and overviews. */
export const OFFICE_GROUPS: { label: string; kinds: OfficeKind[] }[] = [
  { label: 'Federal', kinds: ['president', 'us_senator', 'us_representative'] },
  { label: 'Governor and statewide officers', kinds: ['governor', 'lt_governor', 'attorney_general', 'secretary_of_state', 'treasurer', 'auditor', 'superintendent',
    'insurance_commissioner', 'agriculture_commissioner', 'labor_commissioner', 'land_commissioner', 'other_statewide'] },
  { label: 'Commissions and boards', kinds: ['commissioner', 'education_board', 'regent'] },
  { label: 'Courts', kinds: ['justice', 'appellate_judge'] },
  { label: 'State legislatures', kinds: ['state_senator', 'state_representative'] },
];

/** The race, as said in commentary ("the treasurer's race", "the Supreme Court race"). */
export function raceWord(kind: string, label: string): string {
  switch (kind) {
    case 'us_senator': return 'Senate race';
    case 'governor': return "governor's race";
    case 'lt_governor': return "lieutenant governor's race";
    case 'attorney_general': return 'attorney general race';
    case 'secretary_of_state': return 'secretary of state race';
    case 'treasurer': return "treasurer's race";
    case 'auditor': return 'race for auditor';
    case 'superintendent': return 'race for schools superintendent';
    case 'insurance_commissioner': return 'race for insurance commissioner';
    case 'agriculture_commissioner': return 'race for agriculture commissioner';
    case 'labor_commissioner': return 'race for labor commissioner';
    case 'land_commissioner': return 'race for land commissioner';
    case 'justice': return 'Supreme Court race';
    case 'appellate_judge': return 'appeals court race';
    case 'commissioner': case 'education_board': case 'regent': case 'other_statewide': return `race for ${label.replace(/^\d{4} /, '')}`;
    default: return 'race';
  }
}
