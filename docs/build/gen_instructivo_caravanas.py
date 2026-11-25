# -*- coding: utf-8 -*-
"""Instructivo: Caravanas / Recuento (control de stock por caravana, sin fichas)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Caravanas-Recuento.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=21, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

def callout(text, bg, bd, tx):
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

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Caravanas / Recuento", st_title))
    E.append(Paragraph("Controlar el stock pasando la tropa por la manga, sin usar Fichas 360 ni Rodeos", st_sub))
    E.append(Paragraph(
        "Pensado para empresas de <b>cría</b> que caravanean cada animal con una caravana de control "
        "(RFID / electrónica) y controlan el stock haciendo <b>recuentos por la manga</b>. Llevás un "
        "<b>padrón liviano</b> (caravana + sexo + categoría + lote, y la madre si querés) y, cuando "
        "pasás la tropa por la manga, el sistema te dice <b>cuáles faltan</b>. No es la ficha individual "
        "con peso de cada animal (eso para 1.000 cabezas es un montón): es solo identidad y control de "
        "stock. Está en <b>Ganadería y Haras &rarr; Caravanas / Recuento</b>.", st_intro))
    E.append(callout("<b>Se engancha con tu stock:</b> &nbsp; cada alta suma y cada baja/venta resta al "
                     "<b>stock de hacienda</b> por campo/lote/categoría que ya llevás por movimientos. "
                     "No hay doble carga.", G100, G600, G900))
    E.append(Spacer(1, 3))

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Dar de alta las caravanas (el caravaneo)", st_h2))
    E.append(steps([
        "Andá a <b>Ganadería y Haras &rarr; Caravanas / Recuento</b> y abrí la pestaña <b>Alta por caravana</b>.",
        "Arriba elegí los <b>datos por defecto</b> de la tanda: <b>campo</b>, <b>lote</b>, <b>categoría</b> "
        "(ej. Terneros / Terneras) y <b>Alta por</b> (Nacimiento para los nacidos, Compra si los compraste).",
        "En la grilla, por cada animal <b>escaneá o tecleá</b> la caravana (RFID y/o el número visual) y "
        "elegí el <b>sexo</b>. Con <b>Enter</b> se agrega otra fila sola; también tenés +Agregar fila / +10 filas.",
        "Si querés dejar el <b>ternero señalado</b> a su madre, en la columna <b>Madre</b> escribí/escaneá la "
        "caravana de la vaca (tiene que estar en el padrón).",
        "Tocá <b>Dar de alta</b>: se crea el padrón y se <b>suma el stock</b> de hacienda de ese campo/lote/categoría.",
    ]))
    E.append(callout("<b>Caravana de control (uso interno):</b> es la que el lector lee en la manga. Podés "
                     "cargar el RFID y/o el número visual; con cualquiera de los dos alcanza, pero el "
                     "<b>recuento</b> se hace por lo que lee la manga (el RFID).", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Hacer un recuento (pasar la tropa por la manga)", st_h2))
    E.append(steps([
        "Abrí la pestaña <b>Recuento por manga</b> y elegí el <b>campo</b> y el <b>lote</b> que estás recontando.",
        "Cargá las caravanas que pasaste: <b>pegá la lista</b> (una por línea) o tocá <b>Importar archivo "
        "del lector</b> y subí el CSV / TXT / Excel que exporta el bastón o la manga.",
        "Tocá <b>Correr recuento</b>. Vas a ver cuatro números: <b>padrón esperado</b>, <b>leídas</b>, "
        "<b>presentes</b> y <b>faltan</b>.",
        "En <b>Faltantes</b> están las que deberían estar y no se leyeron, con su número visual: esas son "
        "las que vas a buscar. En <b>Desconocidas</b> están las que se leyeron pero no tienen alta.",
        "Si querés, tocá <b>Guardar este recuento</b> para dejarlo en el <b>Historial</b>.",
    ]))
    E.append(callout("<b>Ejemplo:</b> en el lote Cría hay 250 caravanas en el padrón. Pasás la tropa y el "
                     "lector lee 240. El sistema marca <b>10 faltantes</b> con su número &rarr; las buscás, "
                     "las traés al corral y volvés a pasar las que faltaban para confirmar.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Rotación de lotes y bajas", st_h2))
    E.append(steps([
        "<b>Mover de lote</b> (rotación): en la pestaña <b>Padrón</b>, tildá las caravanas y tocá "
        "<b>Mover seleccionadas de lote</b>; elegí el lote destino. El stock se traslada solo entre lotes.",
        "<b>Baja</b> (muerte o venta): en el padrón, botón <b>Baja</b> de la caravana, elegí el motivo. "
        "Descuenta la cabeza del stock de hacienda.",
        "<b>Error de carga</b>: el botón de la papelera borra la caravana; si estaba activa, ajusta el "
        "stock en -1 para que cierre.",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("No quiero cargar peso ni foto de cada animal, somos muchos. ¿Sirve igual?",
         "Sí. Este módulo es justamente para eso: solo caravana, sexo, categoría y lote. No pide peso ni foto. Es apto para rodeos grandes."),
        ("¿Puedo importar lo que larga el lector de manga o el bastón?",
         "Sí. En el Recuento, botón 'Importar archivo del lector': acepta CSV, TXT y Excel. El sistema toma los números de caravana (RFID) del archivo. También podés pegar la lista a mano."),
        ("¿Qué pasa con el stock de hacienda que ya llevo por movimientos?",
         "Se mantiene sincronizado solo. Cada alta por caravana suma, cada baja/venta resta y cada mover de lote traslada, en el mismo stock por campo/lote/categoría que ya usabas. No hay que cargar dos veces."),
        ("¿Qué es una caravana 'desconocida' en el recuento?",
         "Una que el lector leyó pero no está en el padrón (todavía no la diste de alta). Podés darla de alta en un clic desde el resultado del recuento."),
        ("¿Necesito usar Rodeos o las Fichas 360 para esto?",
         "No. Es un módulo aparte y liviano. Si en el futuro quisieras llevar pesos y costo por kilo, esos módulos siguen estando disponibles, pero no son necesarios para el control de stock por caravana."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
