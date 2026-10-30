import * as functions from "firebase-functions";
import { latestForm } from "../forms/forms";
import { findAccount } from "../accounts/accounts";

export const checkIn = functions.https.onCall(async (req: { data: { name: string } }) => {
  const account = await findAccount(req.data.name);
  return { account, form: await latestForm(account) };
});
