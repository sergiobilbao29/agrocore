# -*- coding: utf-8 -*-
"""Instructivo: Sociedades / UTE (negocio en participacion multiempresa) — PDF estilo AgroCore."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Sociedades-UTE.pdf")
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
    E.append(Paragraph("Sociedades / UTE", st_title))
    E.append(Paragraph("Un negocio de campana en conjunto entre varias empresas y socios, paso a paso", st_sub))
    E.append(Paragraph(
        "Cuando armas una <b>sociedad de campana</b> (una UTE o sociedad de hecho) con otras firmas o socios "
        "&mdash; uno pone campos, otro maquinaria, otro liquidos, otro empleados &mdash; necesitas llevar la "
        "cuenta de <b>todo el negocio junto</b>: cuanto se sembro, cuanto se cosecho de cada campo, cuanto costo "
        "y como se reparte al final. En AgroCore eso se hace en <b>Produccion &rarr; Sociedades / UTE</b>.", st_intro))
    E.append(callout("<b>Lo mas importante:</b> la sociedad <b>NO cambia la facturacion</b>. Cada <b>carta de porte</b> "
                     "sigue saliendo del titular real del campo (Del Pistrin, DLL, Gerardo o el socio que sea), como "
                     "exige ARCA/SISA. La sociedad solo <b>junta y ordena</b> la cosecha y los costos para ver el "
                     "negocio completo y liquidar a cada socio.", AMBER_BG, AMBER_BD, AMBER_TX))
    E.append(Spacer(1, 3))

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Crear la sociedad", st_h2))
    E.append(steps([
        "Entra a <b>Produccion &rarr; Sociedades / UTE</b> y toca <b>&#65291; Nueva sociedad</b>.",
        "Ponele <b>nombre</b> (ej. &ldquo;SPL &mdash; 2026/27&rdquo;) y la <b>campana / ciclo</b> (ej. 2026/27).",
        "Cargá los <b>socios</b> y en cada uno anota <b>que aporta</b> (campos, maquinaria, liquidos, empleados). Esto es informativo; el % se define despues en la liquidacion.",
        "Guardar. La sociedad queda disponible desde <b>cualquiera</b> de tus empresas (no hace falta cambiar de empresa para verla).",
    ]))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Asignar los campos", st_h2))
    E.append(Paragraph("Abri la sociedad y toca <b>&#65291; Agregar campo</b>. Hay dos tipos:", st_intro))
    E.append(bullets([
        "<b>Campo de una empresa tuya:</b> eleg&iacute; del listado (aparecen los campos de <b>todas</b> tus empresas: Del Pistrin, DLL, Gerardo...). Pod&eacute;s indicar las <b>hect&aacute;reas</b> que van a la sociedad (0 = todo el campo) y el cultivo.",
        "<b>Campo externo (de un socio):</b> si el campo no est&aacute; en ninguna de tus empresas, carg&aacute; <b>nombre, titular/CUIT, localidad, hect&aacute;reas y cultivo</b>. El sistema le crea autom&aacute;ticamente un campo interno para que tambi&eacute;n le puedas cargar labores e insumos. <b>No cambia la titularidad</b>: las cartas de porte siguen saliendo del titular real.",
    ]))
    E.append(callout("<b>Tip:</b> agreg&aacute; todos los campos del negocio, sean tuyos o de los socios. As&iacute; el "
                     "tablero muestra la foto completa de la campa&ntilde;a.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Cargar labores e insumos (desde la sociedad)", st_h2))
    E.append(Paragraph("La forma m&aacute;s c&oacute;moda es cargar todo desde la propia sociedad, <b>sin cambiar de empresa</b>:", st_intro))
    E.append(steps([
        "Dentro de la sociedad, toc&aacute; <b>&#10133; Cargar labor / insumo</b>.",
        "Eleg&iacute; el <b>campo</b> (aparecen todos los de la sociedad: de la empresa que sea, o los externos) y si es <b>insumo</b> o <b>labor</b>.",
        "Complet&aacute; los datos (fecha, hect&aacute;reas, producto/labor, costo...). En insumos pod&eacute;s tildar <b>&ldquo;descontar del stock&rdquo;</b> de la empresa due&ntilde;a del campo, o dejarlo sin tildar para registrar <b>solo el costo</b>.",
        "Guard&aacute;. El dato queda <b>en la empresa due&ntilde;a del campo</b> (se ve tambi&eacute;n en su producci&oacute;n) y <b>no se duplica</b>.",
    ]))
    E.append(callout("<b>Tambi&eacute;n pod&eacute;s</b> seguir cargando como siempre desde cada empresa (Insumos y labores) &mdash; "
                     "la sociedad lo toma igual. Y las <b>cartas de porte</b> se cargan como <b>Viajes</b>: si la CP sale de un socio, "
                     "en el viaje eleg&iacute; la <b>Sociedad / UTE</b> en el selector para que sume a la cosecha.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; Mirar el tablero", st_h2))
    E.append(Paragraph("En la sociedad ves un <b>tablero consolidado</b>: por cada campo, las hect&aacute;reas, el cultivo, "
                       "los <b>kg cosechados</b> (de las cartas de porte) y el <b>costo estimado</b> (labores + insumos), "
                       "con los totales de todo el negocio &mdash; cruzando todas las empresas. Solo suma las campa&ntilde;as del "
                       "<b>ciclo de la sociedad</b> que <b>no est&eacute;n cerradas</b> (por eso conviene cargarle el ciclo, ej. 26/27).", st_intro))

    E.append(Paragraph("PASO 5 &nbsp;&mdash;&nbsp; Liquidar la participacion de cada socio", st_h2))
    E.append(Paragraph("Cuando termina la campa&ntilde;a, toc&aacute; el bot&oacute;n <b>&#128176; Liquidacion</b> dentro de la sociedad:", st_intro))
    E.append(steps([
        "<b>Precio de la cosecha:</b> pon&eacute; el <b>$/tn</b> por defecto y, si quer&eacute;s, un precio distinto por cultivo. El sistema valoriza los kg &rarr; <b>ingreso</b>.",
        "<b>Gastos comunes:</b> carg&aacute; gastos del negocio que no esten en labores/insumos. Pod&eacute;s tildar tambien <b>&ldquo;sumar los costos del sistema&rdquo;</b> para incluir las labores/insumos ya cargados.",
        "<b>Aportes de cada socio:</b> anot&aacute; lo que puso cada uno (campos, maquinaria, liquidos, insumos, empleados) con su monto en $.",
        "<b>% de participacion:</b> pon&eacute; el porcentaje de cada socio. Si no lo tenes definido, toc&aacute; <b>&ldquo;Sugerir % por aporte&rdquo;</b> y lo reparte proporcional a lo que aport&oacute; cada uno.",
        "El sistema calcula <b>Ingreso &minus; Gastos = Resultado</b> y arma el <b>reparto por socio</b>: su % del ingreso, su ganancia (% del resultado) y el <b>neto a cobrar o a poner</b> (su parte de la venta menos lo que aport&oacute;).",
        "Toc&aacute; <b>Guardar y calcular</b>. Con <b>&#128424; Imprimir / PDF</b> sac&aacute;s la liquidacion para pasarle a cada socio.",
    ]))
    E.append(callout("<b>Como leer el reparto:</b> &ldquo;Neto a cobrar/(poner)&rdquo; es la posicion de caja de cada socio: "
                     "si es positivo, le corresponde cobrar; si es negativo, tiene que poner. La suma de los % deber&iacute;a dar 100%.",
                     G100, G600, G900))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("La carta de porte sale a nombre de otra empresa/socio, la puedo sumar igual?",
         "Si. La CP se emite normal desde el titular real del campo. Para que sume a la sociedad, al cargar el viaje elegis la Sociedad en el selector; no se toca la facturacion."),
        ("Tengo que volver a cargar los campos o los insumos?",
         "No. Los campos, labores e insumos se cargan una sola vez donde siempre. La sociedad los toma automaticamente si el campo esta asignado a ella."),
        ("Un campo esta arrendado o es de un socio, sirve igual?",
         "Si. Si esta en alguna de tus empresas, lo eleg&iacute;s del listado; si es de un socio y no esta en el sistema, lo cargas como campo externo con su titular/CUIT."),
        ("La sociedad afecta el stock o las cuentas de mis empresas?",
         "No. Es una vista de gestion que consolida datos. El stock, las cuentas corrientes y la facturacion de cada empresa siguen funcionando igual."),
        ("Puedo cambiar el % de un socio despues?",
         "Si. En la liquidacion edit&aacute;s el % cuando quieras y volv&eacute;s a calcular. Queda guardado en la sociedad."),
        ("La sociedad es solo para esta campana?",
         "Puede ser. Le pon&eacute;s el ciclo (ej. 2026/27) y agreg&aacute;s solo los campos de ese negocio. Para otra campana cre&aacute;s otra sociedad."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
