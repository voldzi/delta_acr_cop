export type NavigationIntent = "automatic" | "restore" | "selection" | "user";

export interface NavigationTicket {
  generation: number;
  intent: NavigationIntent;
}

export interface NavigationAuthority {
  claim(intent: NavigationIntent): NavigationTicket;
  current(): NavigationTicket;
  isCurrent(ticket: NavigationTicket): boolean;
}

/**
 * Makes delayed camera and route operations obey the most recent intent.
 * Any newer user or programmatic request invalidates work that is still in flight.
 */
export function createNavigationAuthority(): NavigationAuthority {
  let ticket: NavigationTicket = { generation: 0, intent: "automatic" };
  return {
    claim(intent) {
      ticket = { generation: ticket.generation + 1, intent };
      return ticket;
    },
    current() {
      return ticket;
    },
    isCurrent(candidate) {
      return candidate.generation === ticket.generation && candidate.intent === ticket.intent;
    }
  };
}
