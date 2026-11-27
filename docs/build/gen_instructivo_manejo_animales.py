# -*- coding: utf-8 -*-
"""Instructivo de manejo de animales (estilo AgroCore):
  - Instructivo-Manejo-de-Animales.pdf   (conteo por campo + ficha de cada animal)
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
# MANEJO DE ANIMALES: CONTEO POR CAMPO + FICHA DE CADA ANIMAL
# ============================================================
build("Instructivo-Manejo-de-Animales.pdf",
  "Manejo de animales: conteo por campo + ficha de cada animal",
  "Llevá el rodeo al día y seguí a cada animal en particular, en bovinos, ovinos y porcinos",
  [
    ("intro", "AgroCore maneja la hacienda de <b>dos formas que se complementan</b>: (1) el <b>conteo</b> por campo y categoría "
              "(el <b>stock de hacienda</b>), para el día a día del rodeo; y (2) la <b>ficha individual</b> de cada animal, para "
              "seguir una vaca, un toro o una oveja en particular (sanidad, partos, pesos, baja). Sirve igual para <b>bovinos, "
              "ovinos y porcinos</b>. Elegí la que necesites según el momento."),

    ("h2", "1) Conteo semanal del rodeo (por campo y categoría)"),
    ("steps", [
        "Entrá a <b>Movimientos de animales</b> (o <b>Stock de hacienda</b>).",
        "Elegí el <b>campo</b> (ej. El Candil) y cargás por <b>categoría</b> cuántas cabezas hay: vacas, toros, terneros, ovejas, "
        "corderos, cerdos, etc. (lo hacés con un <b>Ajuste / Conteo</b> cada vez que vas y contás).",
        "El sistema lleva el <b>declarado (SENASA)</b> y el <b>real</b> por separado y te muestra la diferencia. Podés cargar "
        "también el <b>peso promedio</b> por categoría para ver los kg totales.",
        "Nacimientos, muertes, compras, ventas y traslados se cargan como movimientos y actualizan el stock del campo.",
    ]),
    ("call", ("Para el <b>conteo rápido semanal</b> usá esta pantalla (por categoría, por campo). No hace falta una ficha por "
              "animal para el conteo.", "b")),

    ("h2", "2) Ficha de cada animal (la ficha técnica/médica)"),
    ("steps", [
        "Entrá a <b>Fichas de animales</b> y tocá <b>+ Nuevo animal</b>.",
        "Cargá la <b>especie</b> (Bovino, Ovino, Porcino…), <b>nombre/identificación</b>, <b>caravana visual</b> y la "
        "<b>caravana electrónica (RFID / SENASA electrónico)</b>, <b>sexo</b>, <b>fecha de nacimiento</b> (de ahí sale la edad), "
        "<b>pelaje (manto/color)</b>, <b>raza</b>, <b>categoría</b> y el <b>campo</b> donde está.",
        "<b>Foto:</b> subí la foto del animal (y para un ternero recién nacido, su foto).",
        "En <b>Genealogía</b> elegí la <b>madre</b> (y el padre) de las fichas ya cargadas. Así, en la ficha de la madre vas a "
        "ver sus <b>crías con la foto</b>.",
        "En el <b>historial</b> cargás los eventos a medida que pasan: <b>sanidad/vacunación</b>, <b>desparasitación</b>, "
        "<b>parto</b>, <b>pesaje</b>, <b>traslado</b>, etc. Cada evento puede llevar un costo y un <b>próximo control</b> (te avisa).",
        "Cuando se vende, usás <b>Vender</b> (calcula el margen); si se muere o se descarta, le das de <b>baja</b> desde la ficha "
        "con el motivo.",
    ]),

    ("h2", "3) Aumento diario de peso (ADP / GDP) en recría y engorde"),
    ("bullets", [
        "Cargás <b>pesajes</b> en la ficha (o por <b>caravana electrónica</b> con balanza) y el sistema calcula la "
        "<b>ganancia diaria de peso (GDP = tu ADP)</b> y la evolución.",
        "Para el <b>engorde</b> por lote está <b>Rodeos</b>: agrupás los animales, cargás alimentación y ves el "
        "<b>costo por kilo</b> producido.",
    ]),
    ("call", ("Ovejas y cerdos se manejan igual: en el conteo van como categorías (ovejas, corderos, cerdos) y, si querés seguir "
              "una en particular, le hacés su ficha (especie Ovino / Porcino).", "g")),

    ("faq", [
        ("¿Tengo que hacer una ficha de cada animal?",
         "No. Para el conteo del rodeo alcanza con Movimientos de animales por categoría. La ficha es para los que querés seguir "
         "individualmente (vacas de cría, toros, un animal enfermo)."),
        ("¿Dónde veo la foto del ternero?",
         "En la ficha de la madre, en Descendencia/crías, si cargaste al ternero con su foto y elegiste la madre en Genealogía."),
        ("¿El ADP de dónde sale?",
         "De los pesajes que vas cargando; el sistema calcula la GDP."),
    ]),
  ])
