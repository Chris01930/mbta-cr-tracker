import roster from '../data/cabRoster.json';

/** A control (cab) car from the MBTA roster. */
export interface CabCar {
  /** Cab car number, e.g. "1712". */
  cab: string;
  /** Model designation, e.g. "CTC-4" / "CTC-5". */
  model: string;
  /** Manufacturer, e.g. "Kawasaki" / "Hyundai Rotem". */
  mfg: string;
}

/** Full roster of control cars, sorted by number (bundled from cab_roster.csv). */
export const CAB_ROSTER: CabCar[] = roster as CabCar[];

/** Lookup a roster entry by cab number. */
export const CAB_BY_NUMBER: Record<string, CabCar> = Object.fromEntries(
  CAB_ROSTER.map((c) => [c.cab, c]),
);
