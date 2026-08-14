# Live-proven v0.1.13 checkpoint

This directory banks the exact source archive used for the live-proven OpenClaw Transient Tools v0.1.13 checkpoint on 2026-08-14.

Live environment: OpenClaw 2026.7.1 (2d2ddc4).
Validation: 35/35 regression tests passed, followed by live Sol -> Luna delivery-once proof with staff-chat/DM isolation and persistence suppression intact.

The source ZIP is stored as zero-padded base64 parts because the GitHub connector cannot ingest a local binary file directly. Concatenate part00 through part17 in filename order, then base64-decode the result.

PowerShell reconstruction:

```powershell
$parts = Get-ChildItem -Path . -Filter 'source.zip.b64.part*' | Sort-Object Name
$b64 = (($parts | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join '') -replace '\s',''
[IO.File]::WriteAllBytes('openclaw-plugin-transient-tools-0.1.13-source.zip',[Convert]::FromBase64String($b64))
Get-FileHash -Algorithm SHA256 -Path '.\openclaw-plugin-transient-tools-0.1.13-source.zip'
```

Expected SHA256:
`a832f648e3a96d0ea08f4108353084dd709e4e957cc0ac86f535951bb907efac`

The live-installed TGZ had SHA256:
`f3283ab785562f499c055fa0b133c87060aff88ac3c8fd2cfd3d38127b6cf077`

Do not treat later cleanup/refactors as this checkpoint unless separately live-proven.
