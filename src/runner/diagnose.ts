import { CallResult } from "../types/callResults.js";

export type Category =
  | "pass"
  | "app_bug"
  | "test_input"
  | "auth"
  | "network"
  | "test_assumption"
  | "skipped";
export type Expectation =
  | "success"
  | "invalid_input"
  | "needs_auth"
  | "not_found"
  | "any";

export interface Diagnosis {
  category: Category;
  reason: string;
}

const PASS: Diagnosis = { category: "pass", reason: "As expected." };

const serverMessage = (body: unknown): string => {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const text = record.error ?? record.message;
    if (typeof text === "string") return text.slice(0, 150);
  }
  return typeof body === "string" ? body.slice(0, 150) : "";
};

const is2xx = (status: number) => status >= 200 && status < 300;

export function diagnose(
  expect: Expectation,
  result: CallResult,
  sentAuth: boolean,
  expectStatus?: number[],
): Diagnosis {
  if (result.error) {
    if (result.error.kind === "timeout") {
      return {
        category: "network",
        reason: `${result.error.message}. The route may be hanging.`,
      };
    }
    if (result.error.code === "ECONNREFUSED") {
      return {
        category: "network",
        reason:
          "Connection refused: the server is not running at that address.",
      };
    }
    return {
      category: "network",
      reason: `Request failed: ${result.error.message}`,
    };
  }

  const status = result.status as number;
  const said = serverMessage(result.body);
  const suffix = said ? ` Server said: "${said}"` : "";

  if (expectStatus && expectStatus.length > 0) {
    if (expectStatus.includes(status)) return PASS;
    if (status >= 500) {
      return {
        category: "app_bug",
        reason: `Server error ${status}: the route crashed.${suffix}`,
      };
    }
    return {
      category: "test_assumption",
      reason: `Expected status ${expectStatus.join(" or ")} but got ${status}.${suffix}`,
    };
  }

  if (status >= 500) {
    const when =
      expect === "invalid_input"
        ? " on invalid input"
        : expect === "needs_auth"
          ? " when sent without a token"
          : "";
    return {
      category: "app_bug",
      reason: `Server error ${status}${when}: the route crashed instead of replying cleanly.${suffix}`,
    };
  }

  switch (expect) {
    case "success":
      if (is2xx(status)) return PASS;
      if (status === 401 || status === 403) {
        return {
          category: "auth",
          reason: sentAuth
            ? `Credentials were sent but rejected (${status}).${suffix}`
            : `The route needs authentication but no token or cookie was available (${status}).${suffix}`,
        };
      }
      if (status === 400 || status === 422) {
        return {
          category: "test_input",
          reason: `The generated valid body was rejected (${status}). The schema may have rules the generator does not know.${suffix}`,
        };
      }
      if (status === 404) {
        return {
          category: "test_assumption",
          reason: `Not found (404): the id used probably does not exist.${suffix}`,
        };
      }
      if (status === 409) {
        return {
          category: "test_assumption",
          reason: `Conflict (409): the data probably already exists.${suffix}`,
        };
      }
      return {
        category: "test_assumption",
        reason: `Unexpected status ${status}.${suffix}`,
      };

    case "invalid_input":
      if (status === 400 || status === 422) return PASS;
      if (is2xx(status)) {
        return {
          category: "app_bug",
          reason: `Invalid input was accepted (${status}): the route is missing validation.`,
        };
      }
      if (status === 401 || status === 403) {
        return {
          category: "auth",
          reason: `Rejected with ${status} before validation ran.${suffix}`,
        };
      }
      return {
        category: "test_assumption",
        reason: `Expected 400 or 422 but got ${status}.${suffix}`,
      };

    case "needs_auth":
      if (status === 401 || status === 403) return PASS;
      if (is2xx(status)) {
        return {
          category: "app_bug",
          reason: `Answered ${status} without a token: authentication is not enforced.`,
        };
      }
      return {
        category: "test_assumption",
        reason: `Expected 401 or 403 without a token but got ${status}.${suffix}`,
      };

    case "not_found":
      if (status === 404 || status === 400) return PASS;
      if (is2xx(status)) {
        return {
          category: "app_bug",
          reason: `A made-up id returned ${status}: the route did not check that the record exists.`,
        };
      }
      if (status === 401 || status === 403) {
        return {
          category: "auth",
          reason: `Rejected with ${status}.${suffix}`,
        };
      }
      return {
        category: "test_assumption",
        reason: `Expected 404 but got ${status}.${suffix}`,
      };

    default:
      return PASS;
  }
}
