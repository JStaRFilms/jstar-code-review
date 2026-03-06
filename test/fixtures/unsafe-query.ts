export async function loadUser(db: any, id: string) {
    return db.$queryRawUnsafe(`select * from users where id = '${id}'`);
}
