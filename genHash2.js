const bcrypt = require('bcryptjs');
(async () => {
    const pass = 'uwouwo@1234';
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(pass, salt);
    console.log(hash);
})();
