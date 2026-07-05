from __future__ import annotations

import json
import re
from pathlib import Path

import pdfplumber


PDF_PATH = Path(r"C:\Users\lewis\Downloads\Untitled spreadsheet - Sheet1.pdf")
OUT_PATH = Path("src/data/generatedCustomers.ts")


def parse_number(value: str) -> float:
    value = (value or "").strip().replace("£", "")
    if not value:
        return 0
    return float(value)


def parse_int(value: str) -> int:
    return int(parse_number(value))


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def main() -> None:
    rows: list[dict[str, object]] = []
    with pdfplumber.open(PDF_PATH) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    cells = [clean(cell) for cell in row]
                    if len(cells) < 8:
                        continue
                    if not any(cells):
                        continue
                    if cells[0].lower() == "name" and cells[1].lower() == "adress":
                        continue
                    if not cells[1] or not cells[3] or not cells[4]:
                        continue

                    try:
                        frequency = parse_int(cells[3])
                        price = parse_number(cells[4])
                    except ValueError:
                        continue

                    if frequency <= 0 or price <= 0:
                        continue

                    rows.append(
                        {
                            "name": cells[0],
                            "address": cells[1],
                            "area": cells[2],
                            "frequencyWeeks": frequency,
                            "price": price,
                            "startDate": cells[5],
                            "source": cells[6],
                            "status": cells[7].lower() or "active",
                            "endDate": cells[8],
                            "weeklyRevenue": parse_number(cells[10]) if len(cells) > 10 and cells[10] else 0,
                            "notes": cells[11] if len(cells) > 11 else "",
                        }
                    )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(rows, ensure_ascii=False, indent=2)
    OUT_PATH.write_text(
        "export interface RawPdfCustomer {\n"
        "  name: string;\n"
        "  address: string;\n"
        "  area: string;\n"
        "  frequencyWeeks: number;\n"
        "  price: number;\n"
        "  startDate: string;\n"
        "  source: string;\n"
        "  status: string;\n"
        "  endDate: string;\n"
        "  weeklyRevenue: number;\n"
        "  notes: string;\n"
        "}\n\n"
        f"export const rawPdfCustomers: RawPdfCustomer[] = {payload};\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(rows)} customers to {OUT_PATH}")


if __name__ == "__main__":
    main()
