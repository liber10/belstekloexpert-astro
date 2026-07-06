param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

function Get-EntryText($zip, [string]$entryName) {
  $entry = $zip.GetEntry($entryName)
  if ($null -eq $entry) {
    return $null
  }

  $stream = $entry.Open()
  try {
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8)
    try {
      return $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Get-ColumnIndex([string]$cellRef) {
  $letters = ([regex]::Match($cellRef, '^[A-Z]+')).Value
  $index = 0

  foreach ($char in $letters.ToCharArray()) {
    $index = ($index * 26) + ([int][char]$char - [int][char]'A') + 1
  }

  return $index
}

function Get-CellValue($cell, $namespace, $sharedStrings) {
  $type = [string]$cell.GetAttribute('t')

  if ($type -eq 's') {
    $valueNode = $cell.SelectSingleNode('x:v', $namespace)
    if ($null -eq $valueNode) {
      return ''
    }

    $index = [int]$valueNode.InnerText
    if ($index -ge 0 -and $index -lt $sharedStrings.Count) {
      return $sharedStrings[$index]
    }

    return ''
  }

  if ($type -eq 'inlineStr') {
    $inlineNode = $cell.SelectSingleNode('x:is', $namespace)
    if ($null -ne $inlineNode) {
      return $inlineNode.InnerText
    }

    return ''
  }

  $rawNode = $cell.SelectSingleNode('x:v', $namespace)
  if ($null -eq $rawNode) {
    return ''
  }

  return $rawNode.InnerText
}

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$fileStream = [System.IO.File]::Open(
  $resolvedPath,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,
  [System.IO.FileShare]::ReadWrite
)
$zip = [System.IO.Compression.ZipArchive]::new($fileStream, [System.IO.Compression.ZipArchiveMode]::Read, $false)

try {
  $workbookText = Get-EntryText $zip 'xl/workbook.xml'
  $relsText = Get-EntryText $zip 'xl/_rels/workbook.xml.rels'

  if (-not $workbookText) {
    throw 'xl/workbook.xml not found in XLSX.'
  }

  [xml]$workbookXml = $workbookText
  $workbookNs = [System.Xml.XmlNamespaceManager]::new($workbookXml.NameTable)
  $workbookNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $workbookNs.AddNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')

  $firstSheet = $workbookXml.SelectSingleNode('//x:sheets/x:sheet', $workbookNs)
  if ($null -eq $firstSheet) {
    throw 'No sheets found in XLSX workbook.'
  }

  $sheetName = $firstSheet.GetAttribute('name')
  $relationshipId = $firstSheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $sheetPath = 'xl/worksheets/sheet1.xml'

  if ($relsText -and $relationshipId) {
    [xml]$relsXml = $relsText
    $relNode = $relsXml.Relationships.Relationship | Where-Object { $_.Id -eq $relationshipId } | Select-Object -First 1
    if ($null -ne $relNode -and $relNode.Target) {
      $target = [string]$relNode.Target
      if ($target.StartsWith('/')) {
        $sheetPath = $target.TrimStart('/')
      } else {
        $sheetPath = 'xl/' + $target.TrimStart('/')
      }
    }
  }

  $sharedStrings = @()
  $sharedText = Get-EntryText $zip 'xl/sharedStrings.xml'

  if ($sharedText) {
    [xml]$sharedXml = $sharedText
    $sharedNs = [System.Xml.XmlNamespaceManager]::new($sharedXml.NameTable)
    $sharedNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')

    foreach ($item in $sharedXml.SelectNodes('//x:si', $sharedNs)) {
      $parts = @()
      foreach ($textNode in $item.SelectNodes('.//x:t', $sharedNs)) {
        $parts += $textNode.InnerText
      }
      $sharedStrings += [string]::Join('', $parts)
    }
  }

  $sheetText = Get-EntryText $zip $sheetPath
  if (-not $sheetText) {
    throw "Worksheet $sheetPath not found in XLSX."
  }

  [xml]$sheetXml = $sheetText
  $sheetNs = [System.Xml.XmlNamespaceManager]::new($sheetXml.NameTable)
  $sheetNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')

  $tableRows = @()

  foreach ($rowNode in $sheetXml.SelectNodes('//x:sheetData/x:row', $sheetNs)) {
    $cells = @{}
    $maxColumn = 0

    foreach ($cellNode in $rowNode.SelectNodes('x:c', $sheetNs)) {
      $cellRef = $cellNode.GetAttribute('r')
      if (-not $cellRef) {
        continue
      }

      $columnIndex = Get-ColumnIndex $cellRef
      $maxColumn = [Math]::Max($maxColumn, $columnIndex)
      $cells[$columnIndex] = Get-CellValue $cellNode $sheetNs $sharedStrings
    }

    if ($cells.Count -eq 0) {
      continue
    }

    $rowValues = @()
    for ($i = 1; $i -le $maxColumn; $i++) {
      if ($cells.ContainsKey($i)) {
        $rowValues += $cells[$i]
      } else {
        $rowValues += ''
      }
    }

    if (($rowValues | Where-Object { [string]$_ -ne '' }).Count -gt 0) {
      $tableRows += ,$rowValues
    }
  }

  if ($tableRows.Count -eq 0) {
    @() | ConvertTo-Json -Compress
    exit 0
  }

  $headers = $tableRows[0]
  $objects = @()

  for ($rowIndex = 1; $rowIndex -lt $tableRows.Count; $rowIndex++) {
    $row = [ordered]@{}
    $values = $tableRows[$rowIndex]

    for ($columnIndex = 0; $columnIndex -lt $headers.Count; $columnIndex++) {
      $header = [string]$headers[$columnIndex]
      if (-not $header.Trim()) {
        $header = "Column$($columnIndex + 1)"
      }

      $row[$header] = if ($columnIndex -lt $values.Count) { $values[$columnIndex] } else { '' }
    }

    $objects += [pscustomobject]$row
  }

  $objects | ConvertTo-Json -Depth 6 -Compress
} finally {
  $zip.Dispose()
  $fileStream.Dispose()
}
