/**
 * Driver-app-side type aliases. Mirrors the slim DTOs returned by
 * /driver-auth/* and re-exports the shared types so call sites import
 * from one place.
 */
export type {
  CreateDriverPretripInspectionPayload,
  DriverBriefingAcknowledgmentDto,
  DriverDailyBriefingDto,
  DriverPretripInspectionDto,
  DriverShiftDto,
  DriverTelemetryEventDto,
  JobDto,
  JobEvidenceDto,
  JobEvidenceKind,
  JobFieldPaymentDto,
  JobStatus,
  PretripInspectionItem,
  PretripInspectionItemState,
} from '@ustowdispatch/shared';

export interface DriverPickerEntry {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  employeeNumber: string | null;
}

export interface DriverPickerResponse {
  tenant: { id: string; slug: string; name: string };
  drivers: DriverPickerEntry[];
}

export interface DriverLoginResponse {
  accessToken: string;
  expiresIn: number;
  driver: DriverPickerEntry;
  tenant: { id: string; slug: string; name: string };
}

export interface JobEvidencePresignResponse {
  evidence: {
    id: string;
    s3Key: string;
    kind: string;
    uploadStatus: string;
  };
  upload: {
    url: string;
    key: string;
    expiresAt: number;
    requiredHeaders?: Record<string, string>;
  };
}
