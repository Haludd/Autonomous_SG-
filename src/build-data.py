"""Rebuild compact inputs from the unchanged organizer workbook and full CSV.
Run from any directory: python3 src/build-data.py. Standard library only.
"""
from pathlib import Path
import csv
import hashlib
import json
import re
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE_URL = 'https://jpvccqhcdjfupuquwnwc.supabase.co/storage/v1/object/public/experience-datasets/autonomous-sg-2026/challenge-2-flights.csv'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
workbook = ROOT / 'reference/challenge-2-operational-constraints.xlsx'
tables = {}
with zipfile.ZipFile(workbook) as z:
    strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        strings = [''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', NS)]
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    for sheet in ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet', NS):
        target = rels[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
        target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        rows = []
        for row in ET.fromstring(z.read(target)).findall('s:sheetData/s:row', NS):
            cells = {}
            for cell in row.findall('s:c', NS):
                value, inline = cell.find('s:v', NS), cell.find('s:is', NS)
                text = ''.join(inline.itertext()) if inline is not None else strings[int(value.text)] if cell.get('t') == 's' and value is not None else value.text if value is not None else None
                if text is not None:
                    cells[re.sub(r'\d', '', cell.get('r'))] = text
            if cells:
                rows.append(cells)
        header_index = 1 if sheet.get('name') in ['airport_capacity', 'wake_separation'] else 0
        headers = rows[header_index]
        tables[sheet.get('name')] = [{headers[k]: int(v) if v.isdigit() else v for k, v in row.items() if k in headers} for row in rows[header_index + 1:]]
tables['source'] = {'filename': workbook.name, 'sha256': hashlib.sha256(workbook.read_bytes()).hexdigest(), 'synthetic': True}
(ROOT / 'data/operational-constraints.json').write_text(json.dumps(tables, indent=2))

flights = ROOT / 'data/flights.csv'
records, total, qualifying = [], 0, 0
with flights.open(newline='') as f:
    for source_row, row in enumerate(csv.DictReader(f), 2):
        total += 1
        matches = float(row.get('WEATHER_DELAY') or 0) > 15 or float(row.get('LATE_AIRCRAFT_DELAY') or 0) > 20
        qualifying += matches
        if matches and row['DESTINATION_AIRPORT'] == 'JFK' and row['CANCELLED'] == '0' and row['DIVERTED'] == '0':
            records.append({'sourceRow': source_row, 'record': row})

def example_order(item):
    row = item['record']
    weather, departure = int(row['WEATHER_DELAY'] or 0), int(row['DEPARTURE_DELAY'] or 0)
    arrival = row['SCHEDULED_ARRIVAL'].zfill(4)
    eta = int(arrival[:2]) * 60 + int(arrival[2:]) + departure
    return (0 if 15 < weather < 50 and 0 < departure < 90 else 1, abs(eta - 840), item['sourceRow'])

records.sort(key=example_order)
index = {'totalRows': total, 'qualifyingRows': qualifying, 'jfkArrivalCount': len(records), 'sha256': hashlib.sha256(flights.read_bytes()).hexdigest(), 'sourceUrl': SOURCE_URL, 'records': records[:100]}
(ROOT / 'data/flights-index.json').write_text(json.dumps(index, indent=2))
print(f'{total:,} records; {qualifying:,} qualifying; {len(records):,} JFK arrivals; 100 indexed examples.')
