// Per-vessel technical documentation library (fixture). Kept here alongside the
// other mock/ fixtures rather than inline in the knowledge route, matching the
// convention used by every other module's mock data.
export interface KnowledgeDoc {
  id: string;
  vesselId: string;
  name: string;
  type: string;
  status: string;
  uploadedAt: string;
  size?: string;
}

export const MOCK_DOCUMENTS: { [vesselId: string]: KnowledgeDoc[] } = {
  'vessel-001': [
    {
      id: 'kdoc-001-01',
      vesselId: 'vessel-001',
      name: 'Main Engine Operating Manual - MAN B&W 6G80ME-C',
      type: 'technical_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 300 * 24 * 3600 * 1000).toISOString(),
      size: '24.5 MB',
    },
    {
      id: 'kdoc-001-02',
      vesselId: 'vessel-001',
      name: 'Class Survey Report 2024 - DNV GL',
      type: 'survey_report',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString(),
      size: '8.2 MB',
    },
    {
      id: 'kdoc-001-03',
      vesselId: 'vessel-001',
      name: 'Safety Management System (SMS) v4.2',
      type: 'sms',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
      size: '15.1 MB',
    },
    {
      id: 'kdoc-001-04',
      vesselId: 'vessel-001',
      name: 'Turbocharger Maintenance Manual - ABB TCA88-21',
      type: 'technical_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString(),
      size: '6.8 MB',
    },
    {
      id: 'kdoc-001-05',
      vesselId: 'vessel-001',
      name: 'MARPOL Compliance Procedures',
      type: 'procedure',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString(),
      size: '3.4 MB',
    },
    {
      id: 'kdoc-001-06',
      vesselId: 'vessel-001',
      name: 'Cargo Operations Manual - VLCC',
      type: 'cargo_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString(),
      size: '11.2 MB',
    },
  ],
  'vessel-002': [
    {
      id: 'kdoc-002-01',
      vesselId: 'vessel-002',
      name: 'Main Engine Operating Manual - MAN B&W 6S60ME-C',
      type: 'technical_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString(),
      size: '22.1 MB',
    },
    {
      id: 'kdoc-002-02',
      vesselId: 'vessel-002',
      name: 'Class Survey Report 2023 - ABS',
      type: 'survey_report',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString(),
      size: '9.5 MB',
    },
    {
      id: 'kdoc-002-03',
      vesselId: 'vessel-002',
      name: 'Safety Management System (SMS) v3.8',
      type: 'sms',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString(),
      size: '14.3 MB',
    },
    {
      id: 'kdoc-002-04',
      vesselId: 'vessel-002',
      name: 'Cargo Operations Manual - Aframax',
      type: 'cargo_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 250 * 24 * 3600 * 1000).toISOString(),
      size: '9.8 MB',
    },
  ],
  'vessel-003': [
    {
      id: 'kdoc-003-01',
      vesselId: 'vessel-003',
      name: 'Main Engine Manual - Caterpillar 3516C',
      type: 'technical_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 150 * 24 * 3600 * 1000).toISOString(),
      size: '18.7 MB',
    },
    {
      id: 'kdoc-003-02',
      vesselId: 'vessel-003',
      name: 'Class Survey Report 2024 - Bureau Veritas',
      type: 'survey_report',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      size: '7.1 MB',
    },
    {
      id: 'kdoc-003-03',
      vesselId: 'vessel-003',
      name: 'DP Operations Manual',
      type: 'operations_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString(),
      size: '5.6 MB',
    },
    {
      id: 'kdoc-003-04',
      vesselId: 'vessel-003',
      name: 'Bow Thruster Maintenance Manual - Kongsberg TT-2000-FP',
      type: 'technical_manual',
      status: 'indexed',
      uploadedAt: new Date(Date.now() - 300 * 24 * 3600 * 1000).toISOString(),
      size: '4.2 MB',
    },
  ],
};
