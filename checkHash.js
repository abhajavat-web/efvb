const bcrypt = require('bcryptjs');
(async () => {
    const pass = 'uwo@1234';
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(pass, salt);
    console.log(`Password: ${pass}`);
    console.log(`Hash: ${hash}`);
})();
