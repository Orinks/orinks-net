import { answerDispatch, only } from "@/lib/freight-fate-dispatch";

export const runtime = "nodejs";

// The dispatcher's live desk: carrier, invite code, roster, open orders and
// unheard replies. GET ?driverId=..., Bearer driver token.
export async function GET(request: Request) {
  return answerDispatch(request, { type: "query", name: "getCarrierDesk" });
}

// Open a carrier. Body: { driverId, name, homeTerminal, secondTerminal?,
// nightDispatcherDefault?, lanes? }. Calling again returns the carrier the
// account already runs.
export async function POST(request: Request) {
  return answerDispatch(
    request,
    { type: "mutation", name: "createCarrier" },
    only("name", "homeTerminal", "secondTerminal", "nightDispatcherDefault", "lanes"),
  );
}

// Change the carrier. Body: any of name, homeTerminal, secondTerminal (null
// clears it), nightDispatcherDefault, lanes, newInviteCode: true.
export async function PATCH(request: Request) {
  return answerDispatch(
    request,
    { type: "mutation", name: "updateCarrier" },
    only("name", "homeTerminal", "secondTerminal", "nightDispatcherDefault", "lanes", "newInviteCode"),
  );
}

// Close the carrier; every driver in it is released. Body: { driverId }.
export async function DELETE(request: Request) {
  return answerDispatch(request, { type: "mutation", name: "closeCarrier" });
}
