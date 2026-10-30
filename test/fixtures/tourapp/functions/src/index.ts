import * as functions from "firebase-functions";
import { checkInFlow } from "./checkin";
import { listAll } from "./forms";
import { chargeCard } from "./charge";
export const checkIn = functions.https.onCall((req) => checkInFlow(req.data.id));
export const listForms = functions.https.onCall(() => listAll());
export const charge = functions.https.onCall((req) => chargeCard(req.data.cents));
