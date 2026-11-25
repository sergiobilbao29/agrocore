# -*- coding: utf-8 -*-
"""Instructivo: Circuito de una campaña forrajera multicorte (estilo AgroCore).
Recrea Instructivo-Circuito-Campana-Forrajera-Multicorte.pdf con ortografía correcta.
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
# CIRCUITO DE UNA CAMPAÑA FORRAJERA MULTICORTE
# ============================================================
build("Instructivo-Circuito-Campana-Forrajera-Multicorte.pdf",
  "Circuito de una campaña forrajera multicorte",
  "Centeno, alfalfa, avena: de la siembra a los rollos y su consumo o venta",
  [
    ("intro", "A diferencia de una campaña de grano, una campaña forrajera no termina en una cosecha: se hacen varios "
              "cortes a lo largo del tiempo para confeccionar rollos o fardos, que después se consumen en la hacienda o se "
              "venden. Esta guía recorre todo ese circuito en AgroCore."),
    ("h2", "El circuito de un vistazo"),
    ("call", ("<b>1</b> Campaña forrajera &rarr; <b>2</b> Siembra e insumos &rarr; <b>3</b> Cortes (rollos) &rarr; "
              "<b>4</b> Galpón &rarr; <b>5</b> Consumo o venta", "g")),
    ("h2", "1 . Abrir la campaña forrajera"),
    ("bullets", [
        "Entrá a <b>Producción &rarr; Campañas &rarr; + Nueva campaña</b>.",
        "Elegí el lote y el cultivo (Centeno, Alfalfa, Avena) y, en Tipo de campaña, marcá <b>Forrajera multicorte</b>.",
        "Esta campaña no se cierra en el primer corte: queda abierta para ir cargando cada corte.",
    ]),
    ("h2", "2 . Siembra e insumos"),
    ("bullets", [
        "Cargá la siembra y los insumos igual que en una campaña común (Insumos/Labores): semilla, fertilizante, "
        "labores.",
        "Ese costo es el que después vas a repartir entre los cortes para valuar cada rollo.",
    ]),
    ("h2", "3 . Cortes: confeccionar rollos o fardos"),
    ("bullets", [
        "En la card de la campaña forrajera aparece el botón <b>Cortes</b>. Tocá <b>+ Nuevo corte</b>.",
        "Cargá la fecha, el trabajo (corte / hilerado / enrollado / enfardado), el rinde (cantidad de rollos, fardos o kg) y "
        "los costos: contratista (la confección) e insumos imputados (la parte de la siembra que le asignás a ese "
        "corte).",
        "Elegí el destino: galpón (se confeccionan y entran al stock) o pastoreo directo (solo queda registrado).",
    ]),
    ("call", ("Costo unitario del rollo = (insumos imputados + contratista) / cantidad. Ej.: si el corte costó $200.000 y salieron 50 "
              "rollos, cada rollo entra al galpón a $4.000.", "b")),
    ("h2", "4 . Los rollos en el galpón"),
    ("bullets", [
        "Cada corte con destino galpón ingresa los rollos al stock como un artículo (ej. “Rollo de Centeno”) con su "
        "costo unitario.",
        "Ese artículo se comporta como cualquier otro del stock: lo ves en Stock con su cantidad y su costo.",
    ]),
    ("h2", "5 . Dos destinos: consumo animal o venta"),
    ("bullets", [
        "<b>Consumo del rodeo:</b> en <b>Ganadería y Haras &rarr; Rodeos y Hacienda</b>, dentro de un lote, cargás el evento Alimentación "
        "eligiendo el rollo y la cantidad. Se descuenta del galpón y su costo se imputa al costo por kilo de carne de "
        "ese lote.",
        "<b>Venta a un cliente:</b> vendés el rollo desde Stock/Ventas como cualquier producto; se descuenta el stock y se "
        "genera el ingreso.",
    ]),
    ("call", ("Así queda cerrado el círculo: forraje &rarr; rollo valuado &rarr; animal (costo por kilo) o venta.", "g")),
    ("call", ("AgroCore . Circuito de campaña forrajera multicorte . Uso interno / clientes", "g")),
  ])
