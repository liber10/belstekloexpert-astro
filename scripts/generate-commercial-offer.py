from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUTPUT = PUBLIC / "docs" / "belstekloexpert-kommercheskoe-predlozhenie-yurlica.pdf"
LOGO = PUBLIC / "images" / "belstekloexpert-logo.png"

FONT_REGULAR = Path("C:/Windows/Fonts/arial.ttf")
FONT_BOLD = Path("C:/Windows/Fonts/arialbd.ttf")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("OfferRegular", str(FONT_REGULAR)))
    pdfmetrics.registerFont(TTFont("OfferBold", str(FONT_BOLD)))


def paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text, style)


def bullet_items(items: list[str], style: ParagraphStyle) -> list[Paragraph]:
    return [paragraph(f"• {item}", style) for item in items]


def on_page(canvas, doc) -> None:
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#d8e1de"))
    canvas.line(18 * mm, 16 * mm, 192 * mm, 16 * mm)
    canvas.setFont("OfferRegular", 8)
    canvas.setFillColor(colors.HexColor("#5f6e6a"))
    canvas.drawString(18 * mm, 10 * mm, "BelStekloExpert - автостекла для юрлиц и автопарков")
    canvas.drawRightString(192 * mm, 10 * mm, f"стр. {doc.page}")
    canvas.restoreState()


def build_pdf() -> None:
    register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="OfferBold",
            fontSize=24,
            leading=28,
            textColor=colors.HexColor("#083f3a"),
            spaceAfter=10,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["BodyText"],
            fontName="OfferRegular",
            fontSize=11.5,
            leading=16,
            textColor=colors.HexColor("#5f6e6a"),
            spaceAfter=14,
        ),
        "h2": ParagraphStyle(
            "Heading2",
            parent=base["Heading2"],
            fontName="OfferBold",
            fontSize=15,
            leading=19,
            textColor=colors.HexColor("#0d5f56"),
            spaceBefore=12,
            spaceAfter=7,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName="OfferRegular",
            fontSize=10.5,
            leading=15,
            textColor=colors.HexColor("#15211f"),
            spaceAfter=6,
        ),
        "body_bold": ParagraphStyle(
            "BodyBold",
            parent=base["BodyText"],
            fontName="OfferBold",
            fontSize=10.5,
            leading=15,
            textColor=colors.HexColor("#15211f"),
            spaceAfter=6,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=base["BodyText"],
            fontName="OfferRegular",
            fontSize=8.5,
            leading=12,
            textColor=colors.HexColor("#5f6e6a"),
        ),
        "center": ParagraphStyle(
            "Center",
            parent=base["BodyText"],
            fontName="OfferBold",
            fontSize=10,
            leading=14,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#083f3a"),
        ),
    }

    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=22 * mm,
        title="Коммерческое предложение BelStekloExpert для юридических лиц",
        author="ООО «БЕЛСТЕКЛОЭКСПЕРТ»",
    )

    story = []

    logo_cell = Image(str(LOGO), width=32 * mm, height=32 * mm) if LOGO.exists() else ""
    header_table = Table(
        [
            [
                logo_cell,
                [
                    paragraph("Общее коммерческое предложение", styles["title"]),
                    paragraph(
                        "Замена, ремонт и подбор автостекол для юридических лиц, автопарков, СТО и коммерческого транспорта в Минске.",
                        styles["subtitle"],
                    ),
                ],
            ]
        ],
        colWidths=[38 * mm, 124 * mm],
    )
    header_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(header_table)

    contact_table = Table(
        [
            ["Адрес мастерской", "Минск, Долгиновский тракт, 150"],
            ["Телефон", "+375-33-682-81-35"],
            ["Email", "info@BelStekloExpert.by"],
            ["Мессенджеры", "Telegram и Viber по номеру +375-33-682-81-35"],
        ],
        colWidths=[42 * mm, 120 * mm],
    )
    contact_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#e9f5f8")),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#083f3a")),
                ("FONTNAME", (0, 0), (0, -1), "OfferBold"),
                ("FONTNAME", (1, 0), (1, -1), "OfferRegular"),
                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#d8e1de")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.append(contact_table)
    story.append(Spacer(1, 8 * mm))

    story.append(paragraph("Кому подходит", styles["h2"]))
    story.extend(
        bullet_items(
            [
                "такси, доставка, курьерские и сервисные автопарки;",
                "СТО, кузовные сервисы, страховые и партнерские организации;",
                "коммерческий транспорт, микроавтобусы, спецтехника и легковые автомобили сотрудников;",
                "компании, которым важны документы, планирование времени и понятная коммуникация.",
            ],
            styles["body"],
        )
    )

    story.append(paragraph("Что выполняем", styles["h2"]))
    services_table = Table(
        [
            [
                paragraph("Подбор автостекла", styles["body_bold"]),
                paragraph("VIN, фото маркировки, год, кузов, датчики, камера, обогрев, молдинги.", styles["body"]),
            ],
            [
                paragraph("Замена стекол", styles["body_bold"]),
                paragraph("Лобовые, боковые и задние стекла с предварительным согласованием комплектации.", styles["body"]),
            ],
            [
                paragraph("Ремонт повреждений", styles["body_bold"]),
                paragraph("Оценка сколов и трещин, рекомендации по ремонту или замене.", styles["body"]),
            ],
            [
                paragraph("Планирование для автопарков", styles["body_bold"]),
                paragraph("Согласование окон записи, приоритет по срочным машинам, подготовка стекла заранее.", styles["body"]),
            ],
        ],
        colWidths=[46 * mm, 116 * mm],
    )
    services_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#d8e1de")),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fbfcfb")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.append(services_table)

    story.append(paragraph("Порядок сотрудничества", styles["h2"]))
    story.extend(
        bullet_items(
            [
                "Компания отправляет список автомобилей, VIN или фото маркировки стекла.",
                "BelStekloExpert уточняет комплектацию, наличие стекла и ориентир по срокам.",
                "Согласуем дату и порядок работ: одиночная машина, серия автомобилей или срочная заявка.",
                "После выполнения передаем рекомендации по эксплуатации и закрывающие документы по согласованному формату.",
            ],
            styles["body"],
        )
    )

    story.append(paragraph("Принцип расчета", styles["h2"]))
    story.append(
        paragraph(
            "Стоимость рассчитывается индивидуально по марке, модели, году, типу стекла, датчикам, камере, обогреву, молдингам, наличию стекла и условиям установки. До начала работ согласуем понятный итоговый ориентир и не раскрываем внутреннюю структуру себестоимости.",
            styles["body"],
        )
    )

    story.append(KeepTogether([
        paragraph("Реквизиты", styles["h2"]),
        Table(
            [
                ["Наименование", "ООО «БЕЛСТЕКЛОЭКСПЕРТ»"],
                ["УНП", "193845742"],
                ["Юридический адрес", "220062, РБ, г. Минск, ул. Тимирязева, д. 121, корп. 3, оф. 21"],
                ["Р/с", "BY60ALFA30122G47020010270000"],
                ["Банк", "ЗАО «Альфа-Банк»"],
                ["БИК", "ALFABY2"],
            ],
            colWidths=[42 * mm, 120 * mm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#e9f5f8")),
                    ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#083f3a")),
                    ("FONTNAME", (0, 0), (0, -1), "OfferBold"),
                    ("FONTNAME", (1, 0), (1, -1), "OfferRegular"),
                    ("FONTSIZE", (0, 0), (-1, -1), 9.2),
                    ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#d8e1de")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ]
            ),
        ),
    ]))

    story.append(Spacer(1, 6 * mm))
    story.append(
        paragraph(
            "Документ носит общий информационный характер. Финальные условия, сроки и стоимость согласуются по конкретной заявке, автомобилю и наличию стекла.",
            styles["small"],
        )
    )

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)


if __name__ == "__main__":
    build_pdf()
