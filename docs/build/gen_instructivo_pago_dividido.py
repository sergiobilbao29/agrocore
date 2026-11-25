# -*- coding: utf-8 -*-
"""Instructivo: Pago dividido - producto (combustible) + cheque (estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(BASE, "Instructivos")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_h3    = S("h3", fontName="Helvetica-Bold", fontSize=11.5, textColor=G900, spaceBefore=8, spaceAfter=3, leading=15)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

KIND = {"g": (G100, G600, G900), "a": (AMBER_BG, AMBER_BD, AMBER_TX), "b": (BLUE_BG, BLUE_BD, BLUE_TX)}

def callout(text, kind="g"):
    bg, bd, tx = KIND[kind]
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build(filename, title, subtitle, blocks):
    out = os.path.join(OUTDIR, filename)
    doc = BaseDocTemplate(out, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = [Paragraph(title, st_title), Paragraph(subtitle, st_sub)]
    for kind, val in blocks:
        if kind == "intro":   E.append(Paragraph(val, st_intro))
        elif kind == "h2":    E.append(Paragraph(val, st_h2))
        elif kind == "h3":    E.append(Paragraph(val, st_h3))
        elif kind == "steps": E.append(steps(val))
        elif kind == "bullets": E.append(bullets(val))
        elif kind == "call":  E.append(callout(val[0], val[1]))
        elif kind == "faq":
            E.append(Paragraph("Preguntas frecuentes", st_h2))
            for q, a in val:
                E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))
    doc.build(E)
    print("PDF generado:", out)

# ============================================================
# PAGO DIVIDIDO: PRODUCTO (COMBUSTIBLE) + CHEQUE
# ============================================================
build("Instructivo-Pago-Dividido-Producto-y-Cheque.pdf",
  "Pagar un flete descontando combustible + cheque",
  "Pago con varios medios: una parte en producto (combustible) y el resto con un cheque, dejando saldo a favor",
  [
    ("intro", "Sirve cuando al fletero (o a cualquier proveedor) le tenés que descontar algo que ya le pagaste (ej.: "
              "combustible que cargó a tu nombre) y el resto lo pagás con un cheque más grande, que deja un saldo a "
              "favor."),
    ("call", ("<b>El secreto:</b> NO uses el método simple “Pago con producto” (ese cancela por el TOTAL). Usá “Pagar con "
              "varios medios”: ahí cada medio lleva su propio importe.", "g")),
    ("h2", "Paso a paso"),
    ("steps", [
        "Entrá a <b>Comercial &rarr; Cuentas a pagar</b> y tocá <b>Pagar</b> en el fletero (o desde el flete/factura).",
        "Tildá el/los comprobantes del flete (o dejalo sin tildar si es “a cuenta”). Arriba queda el <b>Total a pagar</b>.",
        "Tildá “<b>Pagar con varios medios</b>”.",
        "<b>Medio 1 - Producto:</b> elegí Combustible, poné Cantidad 1 y $/unidad 400000 (o Cantidad 400000 x $1) &rarr; "
        "da $400.000.",
        "En ese medio, <b>DESTILDÁ</b> “Descontar del stock”. Es un descuento, no una entrega de tu stock.",
        "<b>Medio 2 - Cheque:</b> elegí el cheque en cartera (o cargá uno nuevo) con su monto real (el grande).",
        "Mirá la barra de abajo: si el cheque + los $400.000 superan el total, dice “sobran $X”.",
        "Tocá <b>Confirmar</b>: registra el pago y el excedente queda como saldo a favor del fletero para el próximo "
        "pago.",
    ]),
    ("call", ("<b>Importante:</b> si dejás tildado “Descontar del stock” en el combustible, el sistema va a intentar sacar stock "
              "de combustible que no tenés. Por eso, en este caso, va SIEMPRE destildado.", "a")),
    ("h2", "Ejemplo"),
    ("bullets", [
        "<b>Total del flete (a pagar):</b> $ 600.000",
        "<b>Medio 1 - Producto:</b> Combustible (sin descontar stock): $ 400.000",
        "<b>Medio 2 - Cheque N° ... (banco):</b> $ 300.000",
        "<b>Suma de medios:</b> $ 700.000",
        "<b>Sobrante = saldo a favor del fletero:</b> $ 100.000",
    ]),
    ("intro", "(Los números son de ejemplo; poné los reales de tu operación.)"),
    ("faq", [
        ("¿Por qué antes me pedía el total?",
         "Porque estabas usando el método simple “Pago con producto”, que cancela la deuda por el total. Con “Pagar "
         "con varios medios” cada medio (producto, cheque, efectivo...) lleva su propio importe."),
        ("¿Dónde queda el saldo a favor?",
         "En la cuenta corriente del fletero. La próxima vez que le pagues, lo podés aplicar (te aparece como saldo a "
         "favor)."),
        ("¿Y si en vez de sobrar, falta?",
         "El sistema hace un pago parcial (de la factura más vieja a la más nueva) y deja el saldo pendiente. También "
         "te avisa."),
        ("¿Puedo poner más de un cheque?",
         "Sí. Agregá tantos medios como necesites (varios cheques, efectivo, transferencia, etc.)."),
    ]),
  ])
