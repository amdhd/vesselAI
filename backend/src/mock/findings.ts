export interface MockSireFinding {
  id: string;
  inspectionId: string;
  vesselId: string;
  chapter: string;
  question: string;
  finding: string;
  severity: 'observation' | 'non-conformance';
  correctiveAction: string | null;
  status: 'open' | 'closed';
  dueDate: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface MockSireInspection {
  id: string;
  vesselId: string;
  inspectorName: string;
  inspectionDate: string;
  location: string;
  overallScore: number;
  status: 'completed' | 'scheduled';
  findings: MockSireFinding[];
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

// MV Merdeka Spirit - Good inspection record, mostly closed
const merdekaInspectionId = 'insp-001-01';
const merdekaInspection2Id = 'insp-001-02';

export const MOCK_SIRE_INSPECTIONS: MockSireInspection[] = [
  // MV Merdeka Spirit - Inspection 1 (18 months ago) - all closed
  {
    id: merdekaInspectionId,
    vesselId: 'vessel-001',
    inspectorName: 'Capt. James Mitchell (Shell)',
    inspectionDate: daysAgo(548),
    location: 'Port Dickson Anchorage',
    overallScore: 88.5,
    status: 'completed',
    findings: [
      {
        id: 'find-001-01',
        inspectionId: merdekaInspectionId,
        vesselId: 'vessel-001',
        chapter: 'Chapter 4 - Navigation',
        question: '4.3.1 - ECDIS type approval',
        finding: 'ECDIS on bridge wing workstation did not have current S-63 charts loaded for the planned voyage area. Charts were 3 weeks past update cycle.',
        severity: 'observation',
        correctiveAction: 'Charts updated immediately during inspection. New chart update procedure implemented requiring weekly verification sign-off by OOW.',
        status: 'closed',
        dueDate: daysAgo(517),
        closedAt: daysAgo(520),
        createdAt: daysAgo(548),
      },
      {
        id: 'find-001-02',
        inspectionId: merdekaInspectionId,
        vesselId: 'vessel-001',
        chapter: 'Chapter 6 - Machinery',
        question: '6.2.4 - Bilge system maintenance',
        finding: 'Bilge high level alarm in aft pump room had sticker over test button indicating it had not been tested in the last 3 months. Log book showed no test entry.',
        severity: 'non-conformance',
        correctiveAction: 'Immediate alarm test conducted and found functional. Monthly test schedule implemented and logged. Alarm test procedure updated in SMS.',
        status: 'closed',
        dueDate: daysAgo(518),
        closedAt: daysAgo(521),
        createdAt: daysAgo(548),
      },
      {
        id: 'find-001-03',
        inspectionId: merdekaInspectionId,
        vesselId: 'vessel-001',
        chapter: 'Chapter 7 - Safety Management',
        question: '7.1.2 - Enclosed space entry procedure',
        finding: 'Rescue equipment at forward pump room entrance was missing the spare SCBA set. Inventory checklist showed it present but equipment was absent.',
        severity: 'observation',
        correctiveAction: 'Missing SCBA sourced from spares and installed. Inventory verification procedure strengthened with physical check requirement.',
        status: 'closed',
        dueDate: daysAgo(533),
        closedAt: daysAgo(535),
        createdAt: daysAgo(548),
      },
    ],
  },

  // MV Merdeka Spirit - Inspection 2 (recent, 4 months ago) - good performance
  {
    id: merdekaInspection2Id,
    vesselId: 'vessel-001',
    inspectorName: 'Capt. Hiroshi Tanaka (MOC)',
    inspectionDate: daysAgo(120),
    location: 'Singapore Anchorage',
    overallScore: 92.0,
    status: 'completed',
    findings: [
      {
        id: 'find-001-04',
        inspectionId: merdekaInspection2Id,
        vesselId: 'vessel-001',
        chapter: 'Chapter 2 - Crew',
        question: '2.4.1 - Rest hours compliance',
        finding: 'One officer (3rd Officer) showed rest hour record with 9.8 hours rest in a 24-hour period on 3 occasions over the last month, marginally below the required 10 hours.',
        severity: 'observation',
        correctiveAction: 'Watch schedule reviewed and adjusted to ensure minimum rest hours are met. Master briefed all officers on MLC rest hour requirements.',
        status: 'closed',
        dueDate: daysAgo(90),
        closedAt: daysAgo(95),
        createdAt: daysAgo(120),
      },
      {
        id: 'find-001-05',
        inspectionId: merdekaInspection2Id,
        vesselId: 'vessel-001',
        chapter: 'Chapter 9 - Pollution Prevention',
        question: '9.3.2 - ORB entries',
        finding: 'Oil Record Book Part I had one entry where the quantity transferred was recorded in cubic meters instead of the required metric tonnes, causing potential misinterpretation.',
        severity: 'observation',
        correctiveAction: 'Entry corrected and supplementary note added. All officers briefed on ORB entry requirements. New double-check system implemented.',
        status: 'closed',
        dueDate: daysAgo(105),
        closedAt: daysAgo(108),
        createdAt: daysAgo(120),
      },
    ],
  },

  // MT Kerteh Venture - Poor inspection, open non-conformances
  {
    id: 'insp-002-01',
    vesselId: 'vessel-002',
    inspectorName: 'Capt. Lars Eriksson (BP)',
    inspectionDate: daysAgo(65),
    location: 'Fujairah Anchorage',
    overallScore: 61.0,
    status: 'completed',
    findings: [
      {
        id: 'find-002-01',
        inspectionId: 'insp-002-01',
        vesselId: 'vessel-002',
        chapter: 'Chapter 4 - Pollution Prevention',
        question: '4.1.3 - MARPOL compliance - ORB completeness',
        finding: 'CRITICAL: Oil Record Book Part I had 12 consecutive days with no entries despite vessel being underway. Chief Engineer could not explain the gap. Bilge overboard valve seals showed evidence of tampering. Inspector unable to verify compliance with MARPOL Annex I during this period.',
        severity: 'non-conformance',
        correctiveAction: null,
        status: 'open',
        dueDate: daysFromNow(25),
        closedAt: null,
        createdAt: daysAgo(65),
      },
      {
        id: 'find-002-02',
        inspectionId: 'insp-002-01',
        vesselId: 'vessel-002',
        chapter: 'Chapter 8 - Machinery',
        question: '8.2.1 - Main engine maintenance records',
        finding: 'Main engine cylinder unit overhauls are overdue by 2,100 running hours beyond manufacturer recommended interval. No approved deviation from class surveyor on file. Engine running hours log showed 22,400 hours since last overhaul against recommended 20,000 hour interval.',
        severity: 'non-conformance',
        correctiveAction: null,
        status: 'open',
        dueDate: daysFromNow(15),
        closedAt: null,
        createdAt: daysAgo(65),
      },
      {
        id: 'find-002-03',
        inspectionId: 'insp-002-01',
        vesselId: 'vessel-002',
        chapter: 'Chapter 6 - Cargo and Ballast Operations',
        question: '6.4.2 - Cargo pump room entry procedure',
        finding: 'Portable gas detector in cargo pump room failed calibration check during inspection. Last calibration entry in log was 48 days ago, against required 30-day interval.',
        severity: 'non-conformance',
        correctiveAction: 'Detector sent ashore for calibration during port stay. Spare unit sourced from stores and calibrated. Calibration schedule now tracked in PMS.',
        status: 'closed',
        dueDate: daysAgo(50),
        closedAt: daysAgo(55),
        createdAt: daysAgo(65),
      },
      {
        id: 'find-002-04',
        inspectionId: 'insp-002-01',
        vesselId: 'vessel-002',
        chapter: 'Chapter 5 - Fire Safety',
        question: '5.3.1 - Fixed fire detection system',
        finding: 'Three smoke detectors in engine room (ER-SD-007, ER-SD-012, ER-SD-018) showed fault condition on main fire panel. Chief Engineer stated they have been in fault for 6 weeks pending spare parts order.',
        severity: 'observation',
        correctiveAction: 'Emergency work order raised. Spare detectors being sourced from Singapore agent. Chief Engineer monitoring manually until parts arrive.',
        status: 'open',
        dueDate: daysFromNow(10),
        closedAt: null,
        createdAt: daysAgo(65),
      },
      {
        id: 'find-002-05',
        inspectionId: 'insp-002-01',
        vesselId: 'vessel-002',
        chapter: 'Chapter 3 - Navigation',
        question: '3.6.2 - Voyage planning documentation',
        finding: 'Voyage plan for current passage did not include weather routing analysis or alternative route consideration as required by company SMS procedure VPS-04.',
        severity: 'observation',
        correctiveAction: 'Master acknowledged procedure gap. Retroactive weather analysis completed. SMS procedure VPS-04 re-briefed to navigation officers.',
        status: 'closed',
        dueDate: daysAgo(50),
        closedAt: daysAgo(52),
        createdAt: daysAgo(65),
      },
    ],
  },

  // OSV Tenaga Satu - Moderate inspection
  {
    id: 'insp-003-01',
    vesselId: 'vessel-003',
    inspectorName: 'Mr. David Koh (ExxonMobil)',
    inspectionDate: daysAgo(90),
    location: 'Kerteh Anchorage',
    overallScore: 74.5,
    status: 'completed',
    findings: [
      {
        id: 'find-003-01',
        inspectionId: 'insp-003-01',
        vesselId: 'vessel-003',
        chapter: 'Chapter 7 - Deck Operations',
        question: '7.2.4 - Anchor equipment maintenance',
        finding: 'Port anchor chain brake band showed visible wear beyond acceptable limits. Spare brake band not available on board. Anchoring operations restricted to fair weather until repair.',
        severity: 'non-conformance',
        correctiveAction: 'Temporary repair conducted. New brake band ordered from maker. Operations limited to port anchor until resolved.',
        status: 'closed',
        dueDate: daysAgo(60),
        closedAt: daysAgo(55),
        createdAt: daysAgo(90),
      },
      {
        id: 'find-003-02',
        inspectionId: 'insp-003-01',
        vesselId: 'vessel-003',
        chapter: 'Chapter 2 - Safety Equipment',
        question: '2.1.3 - Liferaft servicing',
        finding: 'Port forward liferaft service date expired 22 days before inspection. Service record showed it was sent ashore but service station report had not been returned to vessel.',
        severity: 'observation',
        correctiveAction: 'Service confirmation received from service station (serviced 3 weeks prior). Original oversight was in document return. Digital document management system being implemented.',
        status: 'closed',
        dueDate: daysAgo(75),
        closedAt: daysAgo(78),
        createdAt: daysAgo(90),
      },
      {
        id: 'find-003-03',
        inspectionId: 'insp-003-01',
        vesselId: 'vessel-003',
        chapter: 'Chapter 9 - Crew Certification',
        question: '9.1.2 - Advanced fire fighting certificates',
        finding: 'Bosun (an able seaman acting as Bosun) held a valid AFF certificate but this was not entered in the crew certification matrix maintained by Master.',
        severity: 'observation',
        correctiveAction: 'Crew matrix updated immediately. Crew certificate verification process reviewed and updated.',
        status: 'closed',
        dueDate: daysAgo(80),
        closedAt: daysAgo(82),
        createdAt: daysAgo(90),
      },
      {
        id: 'find-003-04',
        inspectionId: 'insp-003-01',
        vesselId: 'vessel-003',
        chapter: 'Chapter 4 - Pollution Prevention',
        question: '4.5.1 - Sewage system',
        finding: 'Sewage treatment plant effluent quality test log showed no entries for the past 14 days. Chief Engineer stated the plant was operating normally but tests were not being recorded.',
        severity: 'observation',
        correctiveAction: 'Daily testing resumed with proper logging. Weekly testing frequency confirmed compliant with MARPOL Annex IV requirements.',
        status: 'open',
        dueDate: daysFromNow(20),
        closedAt: null,
        createdAt: daysAgo(90),
      },
    ],
  },
];

export const MOCK_SIRE_FINDINGS: MockSireFinding[] = MOCK_SIRE_INSPECTIONS.flatMap(
  (inspection) => inspection.findings
);

export const getFindingsByVesselId = (vesselId: string): MockSireFinding[] => {
  return MOCK_SIRE_FINDINGS.filter((f) => f.vesselId === vesselId);
};

export const getInspectionsByVesselId = (vesselId: string): MockSireInspection[] => {
  return MOCK_SIRE_INSPECTIONS.filter((i) => i.vesselId === vesselId);
};

export const getOpenFindings = (vesselId: string): MockSireFinding[] => {
  return MOCK_SIRE_FINDINGS.filter((f) => f.vesselId === vesselId && f.status === 'open');
};
