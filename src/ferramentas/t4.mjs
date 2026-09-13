import Firebird from 'node-firebird';

const base = { host:'localhost', port:3050, database:'C:/SolusTeste/EC.FDB', user:'SYSDBA', password:'masterkey' };

function testar(charset) {
  return new Promise((ok) => {
    Firebird.attach({ ...base, charset }, (e, db) => {
      if (e) return ok(`${charset}: ERRO ${e.message}`);
      db.query("SELECT DESCRICAO FROM PRODUTO WHERE BARRAS = '7896098905913'", [], (e2, r) => {
        db.detach();
        if (e2) return ok(`${charset}: ERRO QUERY`);
        const d = r[0]?.DESCRICAO || '';
        ok(`${charset}: ${JSON.stringify(d.slice(0,8))}  codigos=${[...d.slice(0,5)].map(c=>c.charCodeAt(0)).join(',')}`);
      });
    });
  });
}

for (const cs of ['WIN1252','ISO8859_1','NONE','UTF8','ISO8859_2']) {
  console.log(await testar(cs));
}
process.exit(0);
