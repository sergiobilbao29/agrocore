# -*- coding: utf-8 -*-
"""Instructivo: Ficha de Cliente/Proveedor (menú Comercial).
Reemplazó a "Compensación de cuentas".
  - Instructivo-Ficha-Cliente-Proveedor.pdf
"""
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
# FICHA DE CLIENTE / PROVEEDOR (menú Comercial)
# ============================================================
build("Instructivo-Ficha-Cliente-Proveedor.pdf",
  "Ficha de Cliente / Proveedor",
  "Todo lo de un contacto en un solo lugar (reemplaza a “Compensación de cuentas”)",
  [
    ("intro", "La <b>Ficha</b> junta en un solo lugar <b>todo</b> lo de un contacto. Elegís un <b>cliente/proveedor</b> "
              "(obligatorio) y un <b>rango de fechas</b> (arranca con el último mes) y ves todos sus movimientos "
              "en <b>pesos</b> y, si es <b>proveedor de grano</b>, también en <b>kilos</b>."),
    ("h2", "Cómo se usa"),
    ("steps", [
        "Entrá a <b>Comercial &rarr; Ficha Cliente/Proveedor</b>.",
        "Elegí el <b>contacto</b> y (opcional) <b>desde/hasta</b>. Tocá <b>Ver ficha</b>.",
        "Arriba ves los <b>saldos</b>: lo que te debe (cliente), lo que le debés (proveedor) y el <b>neto en $</b>.",
        "Abajo, <b>Movimientos en pesos</b> (ventas, compras, cobros, pagos) con el <b>saldo neto corrido</b>, y si es "
        "proveedor de grano, <b>Movimientos en kilos</b> (grano + canje) con su saldo.",
    ]),
    ("h2", "Operar desde la ficha"),
    ("bullets", [
        "<b>Nueva venta</b> (ya con el contacto elegido).",
        "<b>Nueva compra</b>.",
        "<b>Registrar cobro</b>.",
        "<b>Registrar pago</b>.",
        "<b>Entrega/Retiro de grano</b>.",
    ]),
    ("h2", "Compensar (cliente que también es proveedor)"),
    ("intro", "Si la misma persona te compra y te vende, desde la ficha <b>compensás</b> (neteás lo que te debe contra lo que "
              "le debés). Si todavía no están vinculados, se vinculan por <b>CUIT</b>. Unifica cliente y proveedor por "
              "<b>CUIT/vínculo</b>, sin fusionar nada."),
    ("call", ("+ en pesos = te debe (a cobrar); &minus; = le debés (a pagar). + en kilos = dejó grano (le debés kg); "
              "&minus; = retiró producto.", "g")),
    ("faq", [
        ("¿Por qué no veo la parte de kilos?",
         "Solo aparece si el contacto es <b>proveedor de grano</b>."),
        ("¿Las fechas qué filtran?",
         "La lista de movimientos; el saldo total es siempre el actual y el saldo corrido incluye lo anterior al “desde”."),
    ]),
  ])
