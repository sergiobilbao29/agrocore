# -*- coding: utf-8 -*-
"""Instructivo: Stock de hacienda - declarado (SENASA) vs real (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Stock-Hacienda.pdf")
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
st_cell  = S("cell", fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor("#1f2937"))
st_cellb = S("cellb", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=G900)

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

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def tabla(data, anchos):
    rows = []
    for r_i, row in enumerate(data):
        rows.append([Paragraph(c, st_cellb if r_i==0 else st_cell) for c in row])
    t = Table(rows, colWidths=anchos, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),G100),
        ("GRID",(0,0),(-1,-1),0.5,colors.HexColor("#cbd5e1")),
        ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    return t

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazon del negocio agricola")
    canvas.drawRightString(w-15*mm, 10*mm, "Pagina %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Stock de hacienda: declarado (SENASA) vs real", st_title))
    E.append(Paragraph("Como cargar y mantener bien las cabezas de cada campo en Ganaderia y Haras &rarr; Movimientos de animales", st_sub))
    E.append(Paragraph(
        "El sistema lleva, para cada <b>campo</b> y cada <b>categoria</b> (Vaca, Novillo, Ternero&hellip;), <b>dos numeros distintos</b>: "
        "lo <b>Declarado</b> en SENASA/ARCA y lo <b>Real</b> que hay en el campo. Entender esta diferencia resuelve casi todas las dudas "
        "de carga. La regla principal: el <b>Declarado se escribe a mano</b> y el <b>Real sale de los Movimientos</b>.", st_intro))
    E.append(callout("<b>La idea en una linea:</b> &nbsp; configura las categorias &rarr; carga el <b>Declarado (SENASA)</b> a mano &rarr; "
                     "carga el <b>Real</b> con un <b>Movimiento de Ajuste / Conteo</b> &rarr; de ahi en mas, los movimientos del dia a dia "
                     "mantienen el Real actualizado solos.", G100, G600, G900))

    E.append(Paragraph("Los DOS numeros de cada campo", st_h2))
    E.append(tabla([
        ["Numero", "Que es", "Como se carga"],
        ["Declarado (SENASA)", "Las cabezas que figuran en tu <b>SENASA / ARCA</b> (lo declarado, en papel).",
         "A mano, con <b>+ Categoria</b> o <b>Declarado / kg</b>."],
        ["Real (en el campo)", "Las cabezas que <b>realmente hay</b> hoy en el campo.",
         "<b>NO se escribe a mano:</b> sale de los <b>Movimientos</b> (+ Movimiento)."],
        ["Diferencia", "Real menos Declarado. Avisa si el campo coincide con SENASA.",
         "La calcula el sistema sola."],
    ], [32*mm, 76*mm, 57*mm]))
    E.append(callout("<b>El error mas comun:</b> cargar las cabezas reales del campo con <b>+ Categoria</b> o <b>Declarado / kg</b>. "
                     "Esos botones cargan el <b>Declarado (SENASA)</b> &mdash; por eso parece que &ldquo;lo toma como SENASA&rdquo;. "
                     "El <b>Real</b> siempre se carga con <b>+ Movimiento</b>.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Configurar las categorias (una sola vez)", st_h2))
    E.append(Paragraph("Las categorias de animales (con su especie, rango de kg y peso promedio) se definen en el <b>Catalogo</b>, "
                       "asi todos los campos usan las mismas y no se generan duplicados (ej. ternero/terneros):", st_intro))
    E.append(bullets([
        "En <b>Movimientos de animales</b> toca <b>Categorias (Catalogo)</b>.",
        "Carga cada categoria con su <b>especie</b> (Bovino, Equino&hellip;), <b>peso promedio</b> (kg/cabeza) y, si queres, la <b>matriz</b> de a que categoria puede pasar (ej. Ternero &rarr; Novillito).",
        "El <b>peso promedio</b> se usa para estimar los kg totales y la proyeccion para el banco.",
    ]))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Carga inicial del stock (por campo)", st_h2))
    E.append(Paragraph("Para cada campo ganadero, categoria por categoria:", st_intro))
    E.append(Paragraph("A) Cargar el DECLARADO (SENASA)", st_faq_q))
    E.append(bullets([
        "En la tarjeta del campo toca <b>+ Categoria</b>.",
        "Elegi la <b>categoria</b>, poni las <b>cabezas declaradas en SENASA</b> y el <b>peso promedio</b>.",
        "Si en esa empresa <b>no llevas SENASA</b>, deja el declarado en <b>0</b> (asi la diferencia muestra directo lo real).",
    ]))
    E.append(Paragraph("B) Cargar el REAL (lo que hay en el campo)", st_faq_q))
    E.append(steps([
        "Toca <b>+ Movimiento</b>.",
        "En <b>Tipo</b> elegi <b>Ajuste / Conteo</b>.",
        "Elegi el <b>Campo</b> (y lote/potrero si corresponde) y la <b>Categoria</b>.",
        "En <b>Cantidad (cabezas)</b> poni las cabezas que <b>contaste en el campo</b>. Opcional: los <b>kilos</b> de balanza.",
        "Toca <b>Registrar</b>: ese numero queda como el <b>Real</b> de esa categoria en ese campo.",
    ]))
    E.append(callout("<b>Regla de oro:</b> el <b>Declarado</b> se escribe a mano (dato de SENASA). El <b>Real</b> se construye con movimientos: "
                     "el primero es un <b>Ajuste / Conteo</b> con las cabezas que hay. De ahi en mas, el sistema lo mantiene solo.",
                     G100, G600, G900))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; El dia a dia: mantener el REAL actualizado", st_h2))
    E.append(Paragraph("Cada vez que pasa algo con los animales, cargalo con <b>+ Movimiento</b>. El Real se recalcula solo:", st_intro))
    E.append(tabla([
        ["Movimiento", "Cuando usarlo", "Efecto en el Real"],
        ["Nacimiento", "Nacen terneros / crias.", "Suma (+)"],
        ["Muerte", "Se muere un animal.", "Resta (-)"],
        ["Traslado", "Pasas animales de un campo/lote a otro.", "Resta en origen, suma en destino"],
        ["Cambio de categoria", "Un ternero pasa a novillito, vaquillona a vaca, etc.", "Resta en la de origen, suma en la nueva"],
        ["Ajuste / Conteo", "Conteo fisico y hay diferencia (faltan o sobran).", "Suma o resta (admite negativo, ej. -2)"],
    ], [38*mm, 78*mm, 49*mm]))
    E.append(callout("<b>Compras y ventas de hacienda:</b> no se cargan aca. Se registran en <b>Liquidaciones de animales</b> / <b>Guias</b> "
                     "o como venta por kg, y descuentan o suman el <b>Real</b> (y el SENASA) automaticamente.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("Como leer la Diferencia", st_h2))
    E.append(bullets([
        "<b>Diferencia = 0</b> &rarr; el campo coincide con lo declarado en SENASA. Todo en orden.",
        "<b>Diferencia positiva (+)</b> &rarr; hay <b>mas</b> cabezas en el campo que las declaradas (ej. nacimientos sin declarar).",
        "<b>Diferencia negativa (-)</b> &rarr; hay <b>menos</b> que lo declarado (ventas/muertes sin declarar, o falta cargar el conteo real).",
    ]))
    E.append(callout("<b>Si el Real te da negativo o raro:</b> casi siempre es porque se cargaron muertes/salidas <b>sin haber cargado antes "
                     "el conteo inicial</b>. Solucion: carga un <b>Ajuste / Conteo</b> con las cabezas reales de hoy y el numero se acomoda.",
                     AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("Si ya cargaste mal: como corregirlo", st_h2))
    E.append(Paragraph("<b>Caso tipico:</b> cargaste lo real del campo pero quedo como Declarado (SENASA). Se arregla asi:", st_intro))
    E.append(steps([
        "En la fila de la categoria toca <b>Declarado / kg</b> y poni el Declarado correcto: el numero real de SENASA, o <b>0</b> si no llevas SENASA en esa empresa.",
        "Despues carga el <b>Real</b> con <b>+ Movimiento &rarr; Ajuste / Conteo</b> y las cabezas que hay en el campo.",
        "Si el Real quedo con un numero equivocado, <b>borra el movimiento</b> mal cargado (se recalcula) o carga un <b>Ajuste</b> por la diferencia (positivo o negativo).",
    ]))

    E.append(Spacer(1, 4))
    E.append(callout("<b>Resumen:</b> <b>Declarado</b> = lo de SENASA, se escribe a mano &nbsp;&bull;&nbsp; <b>Real</b> = lo del campo, sale de los "
                     "Movimientos (arranca con <b>Ajuste / Conteo</b>) &nbsp;&bull;&nbsp; la <b>Diferencia</b> es solo el control entre ambos.",
                     G100, G600, G900))

    doc.build(E)
    print("OK ->", OUT)

if __name__ == "__main__":
    build()
