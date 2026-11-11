// Passwords refused when a person chooses their own (docs/PORTAL_API.md 5). A short built-in list for the front end and mock;
// the back end should check against a larger list (for example the top 100,000 of a public breach corpus) as well.

export const COMMON_PASSWORDS = new Set(`
password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword 1234567890 12345678910 123456789012 0123456789
qwertyuiop qwerty123 qwerty1234 qwertyuiop123 1qaz2wsx 1q2w3e4r5t zxcvbnm123 asdfghjkl asdfghjkl1 abcdefghij abcd123456 abc1234567
iloveyou1 iloveyou12 letmein123 letmein1234 welcome123 welcome1234 welcome12345 admin12345 administrator adminadmin admin123456
changeme123 changeme1234 trustno1234 monkey1234 dragon1234 football123 baseball123 sunshine123 princess123 superman123 batman1234
master1234 shadow1234 michael1234 jennifer123 charlie1234 jordan12345 hunter1234 mustang123 starwars123 pokemon123 whatever123
australia123 australia1 sydney12345 melbourne123 brisbane123 newcastle123 queensland1 password2024 password2025 password2026
builder1234 builder12345 samplehomes1 samplehomes123 glideinside1 glideinside123 pocketarchitect
111111111111 1111111111 2222222222 0000000000 1212121212 1234512345 9876543210 12345678901 123456789a abc123abc1
`.split(/\s+/).filter(Boolean));
