# Conversa com a Sefaz usando o certificado digital INSTALADO no Windows.
#
# Por que PowerShell: o certificado A1 fica guardado no Windows (e o mesmo que o
# navegador oferece no site da Sefaz). O .NET do Windows usa esse certificado sem
# copiar o arquivo e sem pedir senha - o Node sozinho nao consegue.
#
# Chamado pelo Plugin (src/sefaz/powershell.js):
#   powershell -File sefaz.ps1 -Acao <certificados|assinar|postar> -Entrada x.json -Saida y.json
# A entrada e a saida vao por arquivo JSON (nada de texto grande na linha de comando).
# Este arquivo NAO tem acento de proposito: o PowerShell 5.1 le .ps1 como ANSI.

param(
  [Parameter(Mandatory = $true)][string]$Acao,
  [Parameter(Mandatory = $true)][string]$Entrada,
  [Parameter(Mandatory = $true)][string]$Saida
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Responder($objeto) {
  [System.IO.File]::WriteAllText($Saida, ($objeto | ConvertTo-Json -Depth 6 -Compress), $utf8)
}

function Achar-Certificado([string]$impressao) {
  $impressao = ($impressao -replace '[^0-9A-Fa-f]', '').ToUpper()
  foreach ($onde in 'CurrentUser', 'LocalMachine') {
    $achado = Get-ChildItem "Cert:\$onde\My" | Where-Object { $_.Thumbprint -eq $impressao } | Select-Object -First 1
    if ($achado) { return $achado }
  }
  throw 'O certificado digital escolhido nao esta mais instalado neste PC.'
}

# e-CNPJ: "CN=NOME DA EMPRESA:12345678000199"
function Cnpj-Do-Certificado($cert) {
  if ($cert.Subject -match 'CN=[^,]*:(\d{14})') { return $Matches[1] }
  return ''
}

try {
  $dados = Get-Content -LiteralPath $Entrada -Raw -Encoding UTF8 | ConvertFrom-Json

  switch ($Acao) {

    'certificados' {
      $lista = @()
      foreach ($onde in 'CurrentUser', 'LocalMachine') {
        foreach ($c in (Get-ChildItem "Cert:\$onde\My" -ErrorAction SilentlyContinue)) {
          $cnpj = Cnpj-Do-Certificado $c
          if (-not $cnpj) { continue }        # so certificado de empresa (e-CNPJ)
          $usavel = $false
          if ($c.HasPrivateKey) {
            try {
              $chave = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($c)
              $usavel = ($null -ne $chave)
            } catch { $usavel = $false }
          }
          $lista += [pscustomobject]@{
            impressao = $c.Thumbprint
            nome      = (($c.Subject -replace '^CN=([^,]+).*$', '$1') -replace ':\d{14}$', '')
            cnpj      = $cnpj
            validoDe  = $c.NotBefore.ToString('yyyy-MM-ddTHH:mm:ss')
            validoAte = $c.NotAfter.ToString('yyyy-MM-ddTHH:mm:ss')
            usavel    = $usavel
            onde      = $onde
          }
        }
      }
      Responder @{ ok = $true; certificados = @($lista) }
    }

    'assinar' {
      # assina cada <infEvento Id="..."> do jeito que a Sefaz exige:
      # XMLDSig envelopado, C14N, RSA-SHA1 e o certificado junto (KeyInfo)
      Add-Type -AssemblyName System.Security
      $cert = Achar-Certificado $dados.impressao
      $chave = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
      $doc = New-Object System.Xml.XmlDocument
      $doc.PreserveWhitespace = $true
      $doc.LoadXml([string]$dados.xml)
      $nomes = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
      $nomes.AddNamespace('n', 'http://www.portalfiscal.inf.br/nfe')
      $alvos = $doc.SelectNodes('//n:' + [string]$dados.tag, $nomes)
      if ($alvos.Count -eq 0) { throw ('Nada para assinar: nao achei ' + $dados.tag) }
      foreach ($alvo in $alvos) {
        $assinado = New-Object System.Security.Cryptography.Xml.SignedXml($doc)
        $assinado.SigningKey = $chave
        $assinado.SignedInfo.CanonicalizationMethod = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
        $assinado.SignedInfo.SignatureMethod = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
        $referencia = New-Object System.Security.Cryptography.Xml.Reference('#' + $alvo.GetAttribute('Id'))
        $referencia.DigestMethod = 'http://www.w3.org/2000/09/xmldsig#sha1'
        $referencia.AddTransform((New-Object System.Security.Cryptography.Xml.XmlDsigEnvelopedSignatureTransform))
        $referencia.AddTransform((New-Object System.Security.Cryptography.Xml.XmlDsigC14NTransform))
        $assinado.AddReference($referencia)
        $info = New-Object System.Security.Cryptography.Xml.KeyInfo
        $info.AddClause((New-Object System.Security.Cryptography.Xml.KeyInfoX509Data($cert)))
        $assinado.KeyInfo = $info
        $assinado.ComputeSignature()
        $null = $alvo.ParentNode.AppendChild($doc.ImportNode($assinado.GetXml(), $true))
      }
      # confere a propria assinatura antes de mandar (assinatura errada a Sefaz recusa)
      $todas = $doc.GetElementsByTagName('Signature', 'http://www.w3.org/2000/09/xmldsig#')
      foreach ($sig in $todas) {
        $conferir = New-Object System.Security.Cryptography.Xml.SignedXml($doc)
        $conferir.LoadXml([System.Xml.XmlElement]$sig)
        if (-not $conferir.CheckSignature($cert, $true)) { throw 'A assinatura nao conferiu.' }
      }
      Responder @{ ok = $true; xml = $doc.OuterXml }
    }

    'postar' {
      # SOAP 1.2 com o certificado na conexao (a Sefaz so atende assim)
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $cert = Achar-Certificado $dados.impressao
      $pedido = [Net.HttpWebRequest]::Create([string]$dados.url)
      $pedido.Method = 'POST'
      $pedido.ContentType = 'application/soap+xml; charset=utf-8; action="' + [string]$dados.acao + '"'
      $pedido.Timeout = 60000
      $pedido.ReadWriteTimeout = 60000
      $null = $pedido.ClientCertificates.Add($cert)
      $corpo = $utf8.GetBytes([string]$dados.envelope)
      $pedido.ContentLength = $corpo.Length
      $fluxo = $pedido.GetRequestStream()
      $fluxo.Write($corpo, 0, $corpo.Length)
      $fluxo.Close()
      $resposta = $null
      try {
        $resposta = $pedido.GetResponse()
      } catch {
        $web = $_.Exception
        while ($web -and -not ($web -is [Net.WebException])) { $web = $web.InnerException }
        if ($web -and $web.Response) { $resposta = $web.Response } else { throw }
      }
      $leitor = New-Object System.IO.StreamReader($resposta.GetResponseStream(), $utf8)
      $texto = $leitor.ReadToEnd()
      $leitor.Close()
      Responder @{ ok = $true; status = [int]$resposta.StatusCode; corpo = $texto }
    }

    default { throw ('Acao desconhecida: ' + $Acao) }
  }
} catch {
  $mensagem = $_.Exception.Message
  $interna = $_.Exception.InnerException
  while ($interna) { $mensagem = $interna.Message; $interna = $interna.InnerException }
  Responder @{ ok = $false; erro = $mensagem }
}
