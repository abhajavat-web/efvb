const bcrypt = require('bcryptjs');
(async () => {
    const pass = 'uwo@1234';
    const hash = '$2a$10$qShVtGNynRd72PrOogQvRuM1YKKxo2ceb1akxLzJbI8FKPZLyIYXS';
    const match = await bcrypt.compare(pass, hash);
    console.log(`Password: ${pass}`);
    console.log(`Hash in DB: ${hash}`);
    console.log(`Match: ${match}`);

    const pass2 = 'uwouwo@1234';
    const match2 = await bcrypt.compare(pass2, hash);
    console.log(`Password: ${pass2}`);
    console.log(`Match: ${match2}`);
})();
