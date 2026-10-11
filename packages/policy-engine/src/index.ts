export interface PolicySubject {
  roles: string[];
  clearance?: string;
  organization?: string;
  deviceTrusted?: boolean;
}

export interface PolicyResource {
  classification?: string;
  releasability?: string[];
  synthetic?: boolean;
  areaOfResponsibility?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  auditTags: string[];
}

const roleReadAllowList = new Set([
  "COP_OPERATOR",
  "COP_ANALYST",
  "COMMAND_VIEWER",
  "INTEGRATION_ADMIN",
  "SECURITY_ADMIN",
  "AUDITOR",
  "AI_ADMIN",
  "AI_USER",
  "SYSTEM_CLIENT"
]);

export function evaluateReadPolicy(subject: PolicySubject, resource: PolicyResource): PolicyDecision {
  if (!subject.roles.some((role) => roleReadAllowList.has(role))) {
    return {
      allowed: false,
      reason: "Subject has no COP read role.",
      auditTags: ["RBAC_DENY"]
    };
  }

  if (subject.deviceTrusted === false && resource.classification && resource.classification !== "UNCLASSIFIED") {
    return {
      allowed: false,
      reason: "Untrusted device may only access unclassified data.",
      auditTags: ["ABAC_DEVICE_DENY"]
    };
  }

  const classificationLevels = ["UNCLASSIFIED", "RESTRICTED", "CONFIDENTIAL", "SECRET"];
  const requiredClearance = classificationLevels.indexOf(resource.classification ?? "UNCLASSIFIED");
  const actualClearance = classificationLevels.indexOf(subject.clearance ?? "UNCLASSIFIED");
  if (requiredClearance < 0 || actualClearance < requiredClearance) {
    return {
      allowed: false,
      reason: "Subject clearance does not permit this classification.",
      auditTags: ["ABAC_CLASSIFICATION_DENY"]
    };
  }

  return {
    allowed: true,
    reason: "Read policy allowed.",
    auditTags: ["RBAC_ALLOW", resource.synthetic ? "SYNTHETIC_VISIBLE" : "REAL_VISIBLE"]
  };
}

export function defaultSystemSubject(): PolicySubject {
  return {
    roles: ["SYSTEM_CLIENT"],
    clearance: "UNCLASSIFIED",
    deviceTrusted: true
  };
}
