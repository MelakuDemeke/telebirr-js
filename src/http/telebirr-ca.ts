/**
 * CA certificates needed to verify Telebirr's gateways.
 *
 * Both gateways (`developerportal.ethiotelebirr.et` and
 * `superapp.ethiomobilemoney.et`) use certificates issued by
 * "GlobalSign GCC R3 EV TLS CA 2025", but the TEST gateway serves an
 * incomplete chain (leaf only, no intermediate). Node then fails the
 * handshake with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, which historically pushed
 * integrators toward `verifySsl: false` — a real security footgun against a
 * payment gateway.
 *
 * Shipping the missing intermediate lets verification succeed out of the box.
 * It is used IN ADDITION to Node's default root store (never instead of it),
 * so bundling it only adds a trust path — it cannot weaken verification of
 * any other host.
 *
 * Subject: C=BE, O=GlobalSign nv-sa, CN=GlobalSign GCC R3 EV TLS CA 2025
 * Issuer:  OU=GlobalSign Root CA - R3, O=GlobalSign, CN=GlobalSign
 * Valid:   2025-07-16 → 2027-07-16
 * Source:  http://secure.globalsign.com/cacert/gsgccr3evtlsca2025.crt
 *          (referenced by the gateway certificate's caIssuers AIA field)
 */
export const TELEBIRR_CA_CERTIFICATES: readonly string[] = [
  `-----BEGIN CERTIFICATE-----
MIIElzCCA3+gAwIBAgIRAIPahmyfUtUakxi40OfAMWkwDQYJKoZIhvcNAQELBQAw
TDEgMB4GA1UECxMXR2xvYmFsU2lnbiBSb290IENBIC0gUjMxEzARBgNVBAoTCkds
b2JhbFNpZ24xEzARBgNVBAMTCkdsb2JhbFNpZ24wHhcNMjUwNzE2MDMwNTQ2WhcN
MjcwNzE2MDAwMDAwWjBTMQswCQYDVQQGEwJCRTEZMBcGA1UEChMQR2xvYmFsU2ln
biBudi1zYTEpMCcGA1UEAxMgR2xvYmFsU2lnbiBHQ0MgUjMgRVYgVExTIENBIDIw
MjUwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDEG4l4CpUk556CyXIA
B3ihV2b8sWMNGwnW0wCpuaHHA5rlXpSWE1AD6r9hyGhQOrc45nPOj6Fvsqw8dFZw
FpAJzlk6FxhYP1ve8KPJvIpt6f5v28jOlzfs8c7dJ8ZmqKHB0Zj6RbAvA9vAl2A3
j0mu+ooXN3/QaFvVihDV/SRyOfFBlhPAsRk8y97tLPWx7/4YzfE6NSLKsU1yF+tf
BTttbaXTH/cWY/KQE3ZHTFRo6XouemjPBP9CDXeTR11tm37Bgn3QOj93FHdi1JJp
eNBGEOGvM8qhTV/77kDiUyOvsp4jZOhas6kIRn8nWK7fCPNdFJYi1Ctvd7gnQ1gB
lW71AgMBAAGjggFrMIIBZzAOBgNVHQ8BAf8EBAMCAYYwHQYDVR0lBBYwFAYIKwYB
BQUHAwEGCCsGAQUFBwMCMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0OBBYEFGMQ
f+QoM5r4R2BZUn5XEMdN+BcWMB8GA1UdIwQYMBaAFI/wS3+oLkUkrk1Q+mOai97i
3Ru8MHsGCCsGAQUFBwEBBG8wbTAuBggrBgEFBQcwAYYiaHR0cDovL29jc3AyLmds
b2JhbHNpZ24uY29tL3Jvb3RyMzA7BggrBgEFBQcwAoYvaHR0cDovL3NlY3VyZS5n
bG9iYWxzaWduLmNvbS9jYWNlcnQvcm9vdC1yMy5jcnQwNgYDVR0fBC8wLTAroCmg
J4YlaHR0cDovL2NybC5nbG9iYWxzaWduLmNvbS9yb290LXIzLmNybDAtBgNVHSAE
JjAkMAcGBWeBDAEBMAwGCisGAQQBoDIKAQEwCwYJKwYBBAGgMgEBMA0GCSqGSIb3
DQEBCwUAA4IBAQCtcTjIgw+tiW7E+sCTJ36nrC0IOxMpwE+nTaUG1xQJb+QE18vF
cPvEiqv8OonEBkQJFQ1N5YdDu9kydDYXBmIheYD9Z//TlUBnLL7HBje1ugplB0xE
jpU52q0XLxe6nHfeEKnslZ/Q/eDEsjZKxwF51SlGO6ap+09hfdbfMXDkTsfa+yXg
dIxZRCud0QEBTZAow0iCs3rf5wVALhhh2ePEwqxEm1LkUhvkJMLSCobYcJ+vXprK
JijbpPM602H1kqxNcD/nE7aCNm7g5GTaT04SCGYiQJ32r9mhx34peuYz05pY+AA3
aVB22PDvfoNyGZyClRtNt4KKg8dGJlYEhc3D
-----END CERTIFICATE-----
`,
];
