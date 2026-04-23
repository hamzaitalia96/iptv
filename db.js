const mysql=require('mysql2');

const db=mysql.createConnection({
host:'78.46.164.171',
user:'db_534184',
password:'Ll4POKWSs2SBC9BVuI3g',
database:'db_534184',
port:3306
});

db.connect(err=>{
if(err){
console.log("MYSQL ERROR:",err);
process.exit();
}
console.log("MYSQL CONNECTED");
});

module.exports=db;