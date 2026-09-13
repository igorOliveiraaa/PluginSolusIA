import Firebird from 'node-firebird';
const base = { host:'localhost', port:3050, database:'C:/SolusTeste/EC.FDB', user:'SYSDBA', password:'masterkey', charset:'NONE' };

Firebird.attach(base, (e, db) => {
  if (e) { console.log('erro', e.message); process.exit(1); }
  const sql = "SELECT CAST(DESCRICAO AS VARCHAR(70) CHARACTER SET OCTETS) AS D FROM PRODUTO WHERE BARRAS = '7896098905913'";
  db.query(sql, [], (e2, r) => {
    if (e2) { console.log('erro query:', e2.message); db.detach(); process.exit(1); }
    const v = r[0]?.D;
    console.log('tipo:', Buffer.isBuffer(v) ? 'Buffer' : typeof v);
    if (Buffer.isBuffer(v)) {
      console.log('bytes:', [...v.slice(0,6)].join(','));
      console.log('latin1 :', v.toString('latin1').trim());
      const dec = new TextDecoder('windows-1252');
      console.log('win1252:', dec.decode(v).trim());
    } else {
      console.log('valor:', JSON.stringify(v));
    }
    db.detach();
    process.exit(0);
  });
});
