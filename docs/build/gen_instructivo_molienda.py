# -*- coding: utf-8 -*-
"""Instructivo: Molienda / Fabrica + Plan canje (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Molienda-Fabrica.pdf")
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
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazon del negocio agricola")
    canvas.drawRightString(w-15*mm, 10*mm, "Pagina %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Molienda / Fabrica", st_title))
    E.append(Paragraph("Procesar un grano (ej. soja) y que el stock de los coproductos se arme solo, con el costo de fabricacion y el precio de venta", st_sub))
    E.append(Paragraph(
        "El modulo <b>Molienda / Fabrica</b> es para plantas que transforman un grano en varios productos. Vos "
        "cargas <b>cuantos kilos de soja</b> entraron a moler y el sistema calcula y contabiliza <b>solo</b> cuanto "
        "queda de <b>expeller</b>, de <b>aceite</b> y de <b>merma</b>, y actualiza el stock de cada uno. Ademas "
        "calcula el <b>costo de fabricacion por kilo</b> y, con un <b>% de ganancia</b>, te sugiere el precio de venta. "
        "Esta en <b>Stock y depositos &rarr; Molienda / Fabrica</b>.", st_intro))
    E.append(callout("<b>El circuito en una linea:</b> &nbsp; Cargas los kg de soja &rarr; el sistema descuenta la soja "
                     "del silo e ingresa expeller + aceite + merma &rarr; obtenes costo por kg y precio sugerido.", G100, G600, G900))
    E.append(callout("<b>Ejemplo:</b> entran <b>30.000 kg</b> de soja (88% expeller, 10% aceite, 2% merma) &rarr; quedan "
                     "<b>26.400 kg</b> de expeller, <b>3.000 kg</b> de aceite y <b>600 kg</b> de merma. Todo automatico.", BLUE_BG, BLUE_BD, BLUE_TX))
    E.append(Spacer(1, 3))

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Crear los articulos y los depositos (una sola vez)", st_h2))
    E.append(steps([
        "En <b>Stock</b>, crea los articulos que vas a usar: la <b>Soja</b> (grano de origen) y los coproductos "
        "<b>Expeller de soja</b>, <b>Aceite de soja</b> y <b>Merma</b>. Usa la unidad <b>kg</b> en todos.",
        "En <b>Stock y depositos &rarr; Depositos y cerealeras</b>, crea (si queres separarlos) el <b>silo de soja</b>, "
        "el <b>deposito de expeller</b>, el <b>tanque de aceite</b> y un <b>deposito de mermas</b>. Es opcional: si no "
        "elegis deposito, va al general.",
        "Asegurate de que la <b>soja tenga cargado su costo</b> (entra solo con la compra, o lo podes poner a mano al "
        "cargar el parte).",
    ]))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Definir la formula de molienda (una sola vez)", st_h2))
    E.append(steps([
        "Anda a <b>Stock y depositos &rarr; Molienda / Fabrica</b> y abri la pestana <b>&#9881;&#65039; Formulas</b>.",
        "Toca <b>&#65291; Nueva formula</b>. Poné un <b>nombre</b> (ej. &ldquo;Molienda de soja&rdquo;) y elegi el "
        "<b>grano de origen</b> (Soja).",
        "Agrega un renglon por cada <b>coproducto</b>: elegi el producto, su <b>% de rendimiento</b> (Expeller 88, "
        "Aceite 10, Merma 2) y, si queres, el <b>deposito destino</b>. Tilda <b>merma</b> en el renglon de la merma "
        "(la merma no lleva costo).",
        "Los <b>% deben sumar 100</b>. Abajo vas viendo la suma. Toca <b>Guardar</b>.",
    ]))
    E.append(callout("<b>Coeficiente de costo (opcional):</b> por defecto el costo se reparte igual que el rendimiento. "
                     "Si queres que el aceite &ldquo;cargue&rdquo; mas costo que el expeller (porque vale mas), podes "
                     "poner un coeficiente distinto en cada renglon. Si no lo tocas, funciona bien igual.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Cargar un parte de molienda (cada vez que molés)", st_h2))
    E.append(steps([
        "En <b>Molienda / Fabrica &rarr; &#127981; Partes de molienda</b>, toca <b>&#65291; Nuevo parte de molienda</b>.",
        "Elegi la <b>formula</b> y la <b>fecha</b>. Poné los <b>kg procesados</b> (ej. 30.000) y el <b>silo de origen</b>.",
        "Revisa el <b>costo del grano ($/kg)</b> (viene prellenado con el ultimo costo de la soja) y carga los "
        "<b>costos de produccion</b> del lote (energia, mano de obra, mantenimiento) en pesos.",
        "Mira la <b>vista previa</b>: te muestra cuantos kilos quedan de cada coproducto y el costo por kilo. "
        "Si esta todo bien, toca <b>Registrar molienda</b>.",
        "Listo: el sistema <b>descuenta la soja</b> del silo e <b>ingresa el expeller, el aceite y la merma</b> a sus "
        "depositos, con el costo calculado. Lo ves al toque en <b>Stock</b>.",
    ]))
    E.append(callout("<b>Te equivocaste?</b> En la lista de partes, el boton <b>Anular</b> revierte todo: vuelve la soja "
                     "al silo y saca los coproductos. Despues lo volves a cargar bien.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; Costo de fabricacion y precio de venta", st_h2))
    E.append(steps([
        "Abri la pestana <b>&#127991;&#65039; Costo y precio</b>. Vas a ver cada coproducto con su <b>costo de "
        "fabricacion por kg</b> (lo calculo el ultimo parte de molienda).",
        "En cada uno, carga el <b>% de ganancia</b> que queres y toca <b>Guardar</b>.",
        "El sistema te muestra el <b>precio de venta sugerido por kg</b> (costo x (1 + %)) y lo guarda como precio de "
        "referencia del articulo, listo para usar al vender.",
    ]))

    E.append(Paragraph("PASO 5 &nbsp;&mdash;&nbsp; Plan canje (entregar producto y recibir grano, o al reves)", st_h2))
    E.append(Paragraph(
        "El <b>plan canje</b> sirve cuando entregas un producto (expeller/aceite) y cobras en <b>grano</b> (soja), o "
        "cuando comprás soja y pagás con producto. Se maneja por <b>paridad</b> (una relacion fija) y es en especie "
        "(kilos): mueve el stock, no toca las cuentas en pesos. Esta en la pestana <b>&#128257; Plan canje</b>.", st_intro))
    E.append(steps([
        "Primero crea una <b>paridad</b> (abajo de la pantalla, <b>&#65291; Paridad</b>): elegi que <b>entregas</b>, que "
        "<b>recibis</b> y la <b>relacion</b> (cuantos kg recibis por 1 kg que entregas, ej. 1 : 1,2).",
        "Toca <b>&#65291; Nueva operacion de canje</b>. Elegi el <b>tipo</b>: <b>Venta</b> (entregas producto, cobras en "
        "grano) o <b>Compra</b> (recibis grano, pagas con producto), y la <b>contraparte</b> (cliente o proveedor).",
        "Elegi la <b>paridad</b> (completa las cantidades sola) o cargalas a mano. Revisá que entre en el deposito "
        "correcto y toca <b>Registrar canje</b>.",
        "El stock se ajusta solo: <b>sale</b> lo que entregaste y <b>entra</b> lo que recibiste. Tambien se puede "
        "<b>Anular</b> (revierte el stock).",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Tengo que calcular yo los kilos de expeller y aceite?",
         "No. Vos cargas solo los kilos de soja que entraron a moler; el sistema aplica los porcentajes de la formula y calcula y contabiliza los coproductos solo."),
        ("¿De donde sale el costo de fabricacion por kilo?",
         "Del costo de la soja consumida mas los costos de produccion que cargaste en el parte. Ese total se reparte entre los coproductos (por defecto segun el rendimiento) y se divide por los kilos de cada uno."),
        ("¿La merma lleva costo?",
         "No. La merma se contabiliza en kilos (para que el stock cierre) pero no se le asigna costo: el costo se reparte entre los productos aprovechables (expeller y aceite)."),
        ("Cambie el % de ganancia, ¿se actualiza el precio?",
         "Si. Al guardar en 'Costo y precio', se recalcula el precio sugerido y se guarda como precio de referencia del articulo."),
        ("El canje, ¿genera deuda en pesos?",
         "No. El canje es en especie: mueve kilos de un producto por kilos de otro segun la paridad. No registra importes en la cuenta corriente."),
        ("¿Puedo moler distintos granos o recetas?",
         "Si. Crea una formula por cada receta (cada grano de origen con sus coproductos y porcentajes) y al cargar el parte elegis cual usar."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
