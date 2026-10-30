'use server'

// a comment, then the actions
export async function createUser(name: string) { return name; }
export const deleteUser = async (id: string) => id;
async function addToCart() {}
export { addToCart };
export const LIMIT = 10;
