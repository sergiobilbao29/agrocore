# -*- coding: utf-8 -*-
"""Instructivo: Centros de costo (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Centros-de-Costo.pdf")
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
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Centros de costo", st_title))
    E.append(Paragraph("Saber cuánto gastaste e invertiste en cada parte de tu negocio: por campo, por actividad, por unidad o por proyecto", st_sub))
    E.append(Paragraph(
        "Un <b>centro de costo</b> es una etiqueta a la que le vas sumando los gastos e inversiones para saber, al final, "
        "cuánto costó cada cosa. Puede ser un <b>campo</b> (La Esperanza, El Bajo), una <b>actividad</b> (Agricultura, Ganadería), "
        "una <b>unidad de negocio</b> o un <b>proyecto</b> puntual (Riego, Galpón nuevo). Es una herramienta <b>opcional</b> y se "
        "<b>activa por empresa</b>: mientras no la actives, nada cambia en tu operatoria de todos los días.", st_intro))
    E.append(callout("<b>La idea en una línea:</b> &nbsp; activás el módulo &rarr; creás tus centros &rarr; al cargar compras y gastos "
                     "los <b>repartís</b> entre esos centros &rarr; mirás el <b>reporte</b> para saber cuánto llevás gastado en cada uno.",
                     G100, G600, G900))
    E.append(callout("<b>Permisos:</b> el módulo usa el permiso de <b>Finanzas</b>. Quien pueda ver finanzas verá los centros y el reporte; "
                     "quien pueda crear/editar podrá administrarlos e imputar. Se configura en <b>Administración &rarr; Roles y permisos</b>.",
                     BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 1 - activar
    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Activar los centros de costo (por empresa)", st_h2))
    E.append(Paragraph("Es lo primero y se hace una sola vez por cada empresa que quiera usarlos:", st_intro))
    E.append(steps([
        "Entrá a <b>Administración &rarr; Empresas</b>.",
        "Tocá <b>Editar</b> en la empresa que va a usar centros de costo.",
        "Tildá la opción <b>&ldquo;Usar centros de costo&rdquo;</b> y guardá.",
        "Listo: aparece el módulo <b>Administración &rarr; Centros de costo</b> y, en los formularios de compra y gasto, el bloque de reparto.",
    ]))
    E.append(callout("<b>Opt-in y sin riesgo:</b> si una empresa <b>no</b> lo activa, no ve ningún cambio &mdash; ni el menú ni el reparto. "
                     "Podés activarlo en una empresa y en otra no. Activarlo o desactivarlo no toca los datos ya cargados.", AMBER_BG, AMBER_BD, AMBER_TX))

    # PASO 2 - crear catalogo
    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Crear el catálogo de centros de costo", st_h2))
    E.append(Paragraph("En <b>Administración &rarr; Centros de costo</b> tocá <b>&#65291; Nuevo centro de costo</b> y completá:", st_intro))
    E.append(tabla([
        ["Campo", "Qué es", "Ejemplo"],
        ["Nombre", "Cómo vas a identificar al centro.", "Campo La Esperanza / Agricultura / Proyecto Riego"],
        ["Clasificación", "Si lo que se le imputa es un <b>gasto operativo</b> o una <b>inversión</b>. Sirve para separarlo en el reporte. Es opcional.", "Operativo (gasto) / Inversión"],
        ["Campo vinculado", "Vincularlo a un <b>Campo</b> del sistema. Habilita el <b>prorrateo por hectáreas</b> (ver Paso 3). Es opcional.", "La Esperanza (320 ha)"],
        ["Peso", "Un número de referencia para repartos manuales por defecto. Es opcional.", "320 (ha) / 1 / 2"],
        ["Activo", "Si está activo aparece en los selectores. Los inactivos quedan guardados pero no se ofrecen.", "Sí / No"],
    ], [30*mm, 92*mm, 43*mm]))
    E.append(callout("<b>Cómo conviene armarlos:</b> si tu caso es &ldquo;una razón social con varios campos&rdquo;, creá <b>un centro por campo</b> "
                     "y vinculá cada uno a su Campo (para poder prorratear por hectáreas). Si pensás por actividad, creá &ldquo;Agricultura&rdquo;, "
                     "&ldquo;Ganadería&rdquo;, etc. Podés combinar criterios, pero mantené una lógica clara.", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 3 - formas de reparto
    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Entender las 4 formas de reparto", st_h2))
    E.append(Paragraph("Cuando imputes un comprobante vas a elegir <b>cómo</b> se reparte su importe. Hay cuatro formas:", st_intro))
    E.append(tabla([
        ["Forma", "Cómo funciona", "Cuándo usarla"],
        ["100% a un centro", "Todo el comprobante va a un solo centro.", "La compra/gasto es claramente de un campo o actividad."],
        ["Manual por porcentaje (%)", "Repartís entre varios centros poniendo un % a cada uno. La suma debe dar 100%.", "Sabés la proporción (ej: 60% / 40%) pero no el monto exacto."],
        ["Manual por monto ($)", "Repartís poniendo el importe exacto a cada centro. La suma debe igualar el total.", "Tenés el detalle de cuánto fue a cada uno."],
        ["Prorratear por hectáreas", "El sistema reparte solo, según las hectáreas del Campo vinculado a cada centro.", "Un gasto general (ej: un seguro, una labor común) que se divide por superficie."],
    ], [40*mm, 85*mm, 40*mm]))
    E.append(callout("<b>Prorrateo por hectáreas:</b> solo funciona en los centros que tengan un <b>Campo vinculado</b> con hectáreas cargadas. "
                     "Si elegís esta forma y un centro no tiene hectáreas, el sistema reparte en partes iguales entre los elegidos.", AMBER_BG, AMBER_BD, AMBER_TX))

    # PASO 4 - imputar en compras
    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; Imputar una factura de compra", st_h2))
    E.append(Paragraph("En <b>Compras</b> (Movimientos de compras), al cargar o editar una factura de proveedor:", st_intro))
    E.append(steps([
        "Completá la factura como siempre (proveedor, tipo, ítems, importes).",
        "Abajo del formulario aparece el bloque <b>&#127919; Repartir por centro de costo</b>. Tildalo para activarlo.",
        "Elegí la <b>forma de reparto</b> (100% / por % / por monto / por hectáreas).",
        "Agregá el o los <b>centros</b> y, si corresponde, el % o el monto de cada uno. El resumen te avisa si la suma cierra.",
        "Guardá la factura. El reparto queda asociado al comprobante.",
    ]))
    E.append(bullets([
        "El reparto es <b>opcional</b>: si no tildás el bloque, la factura se guarda igual (sin imputar).",
        "Si <b>editás</b> la factura, podés cambiar el reparto; al guardar se reemplaza por el nuevo.",
        "Si <b>borrás</b> la factura, su reparto se borra solo (no quedan datos sueltos).",
        "Las <b>notas de crédito</b> no llevan reparto (son devoluciones/ajustes).",
    ]))

    # PASO 5 - imputar en gastos diarios
    E.append(Paragraph("PASO 5 &nbsp;&mdash;&nbsp; Imputar un gasto en Movimientos diarios", st_h2))
    E.append(Paragraph("En <b>Tesorería &rarr; Movimientos diarios</b>, al cargar un <b>gasto (egreso)</b> pagado con plata real:", st_intro))
    E.append(steps([
        "Cargá el gasto normal: tipo <b>Egreso</b>, concepto, categoría, monto y el medio de pago.",
        "El reparto aparece para los medios de <b>plata real</b>: <b>efectivo</b>, <b>transferencia</b> o <b>débito</b> bancario.",
        "Tildá <b>&#127919; Repartir por centro de costo</b>, elegí la forma y los centros, igual que en la compra.",
        "Registrá el movimiento. El gasto sale de la caja/banco y, además, queda imputado a los centros elegidos.",
    ]))
    E.append(callout("<b>Qué gastos se pueden repartir:</b> solo los <b>egresos</b> pagados con efectivo, transferencia o débito. "
                     "Los pagos con <b>cheque</b> y los <b>intercompany</b> no llevan reparto en esta etapa. Los ingresos tampoco "
                     "(el centro de costo mide gasto e inversión, no cobros).", AMBER_BG, AMBER_BD, AMBER_TX))

    # PASO 6 - ver el reporte
    E.append(Paragraph("PASO 6 &nbsp;&mdash;&nbsp; Ver el reporte por centro de costo", st_h2))
    E.append(Paragraph("En <b>Administración &rarr; Centros de costo</b> tocá <b>&#128202; Ver reporte</b>:", st_intro))
    E.append(steps([
        "Elegí el <b>período</b> (Desde / Hasta) y tocá <b>Aplicar</b>. Por defecto arranca desde el 1 de enero del año en curso hasta hoy.",
        "Arriba ves las <b>tarjetas de resumen</b>: Total del período, total <b>Operativo</b> (gasto), total <b>Inversión</b> y cantidad de movimientos.",
        "La <b>tabla por centro</b> muestra, para cada uno: lo que vino de <b>compras</b>, lo que vino de <b>gastos diarios</b>, el <b>total</b> "
        "y una barra de <b>participación</b> (qué tan grande es respecto del mayor).",
        "Tocá el <b>nombre de un centro</b> para ver el <b>detalle</b>: cada movimiento con fecha, origen (qué compra o gasto), forma de reparto y monto.",
        "Con <b>&#11015;&#65039; Excel</b> bajás el reporte (resumen + detalle) para abrirlo en una planilla.",
    ]))
    E.append(callout("El reporte se arma con las imputaciones que fuiste cargando en los Pasos 4 y 5. "
                     "Cuanto más prolijo imputes, más fiel es el reporte. Si un centro no aparece, es porque todavía no se le imputó nada en ese período.",
                     BLUE_BG, BLUE_BD, BLUE_TX))

    # EJEMPLO
    E.append(Paragraph("Ejemplo completo", st_h2))
    E.append(Paragraph("NLL S.A. tiene una sola razón social y tres campos. Arma tres centros de costo (uno por campo) y los vincula a sus Campos:", st_intro))
    E.append(tabla([
        ["Centro de costo", "Campo vinculado", "Clasificación"],
        ["Campo La Esperanza", "La Esperanza (320 ha)", "Operativo"],
        ["Campo El Bajo", "El Bajo (180 ha)", "Operativo"],
        ["Campo La Loma", "La Loma (100 ha)", "Operativo"],
    ], [55*mm, 60*mm, 50*mm]))
    E.append(Paragraph("Durante el mes imputan:", st_intro))
    E.append(tabla([
        ["Comprobante", "Forma de reparto", "Resultado"],
        ["Factura de gasoil $ 600.000 (uso general)", "Prorratear por hectáreas (320/180/100 = 600 ha)",
         "La Esperanza $ 320.000 &middot; El Bajo $ 180.000 &middot; La Loma $ 100.000"],
        ["Semilla para La Esperanza $ 400.000", "100% a un centro", "Todo a Campo La Esperanza"],
        ["Flete compartido $ 150.000", "Manual por monto ($)", "La Esperanza $ 100.000 &middot; El Bajo $ 50.000"],
    ], [52*mm, 55*mm, 58*mm]))
    E.append(Paragraph("En el reporte del período, Campo La Esperanza aparece con $ 820.000, El Bajo con $ 230.000 y La Loma con $ 100.000, "
                       "y el total del período da $ 1.150.000.", st_intro))

    # Buenas practicas
    E.append(Paragraph("Buenas prácticas", st_h2))
    E.append(bullets([
        "Definí <b>un criterio</b> (por campo, por actividad o por proyecto) y manteneelo; no mezcles sin necesidad.",
        "Vinculá los centros a su <b>Campo</b> siempre que puedas: te habilita el prorrateo por hectáreas, que ahorra mucho trabajo.",
        "Usá la <b>clasificación</b> (operativo / inversión) para después leer rápido cuánto fue gasto corriente y cuánto fue inversión.",
        "Imputá <b>en el momento</b> de cargar la compra o el gasto: es un segundo y evita tener que revisar todo a fin de mes.",
        "Si no estás seguro del reparto exacto, usá <b>100% a un centro</b> o <b>por hectáreas</b>; siempre podés ajustarlo después editando la compra.",
    ]))

    # FAQ
    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Es obligatorio usar centros de costo?",
         "No. Es opcional y se activa por empresa. Si no lo activás, no ves ningún cambio."),
        ("¿Afecta a los datos que ya tengo cargados?",
         "No. Activarlo solo habilita el módulo y el reparto de acá en adelante. No toca compras ni gastos anteriores."),
        ("¿Qué pasa si activo el módulo pero no imputo nada?",
         "Nada: las compras y gastos se cargan igual que siempre. El reparto es un paso opcional en cada formulario."),
        ("¿Puedo repartir un mismo gasto entre varios campos?",
         "Sí. Usá manual por porcentaje, manual por monto, o prorratear por hectáreas, y agregá todos los centros que quieras."),
        ("¿Cómo funciona el prorrateo por hectáreas?",
         "El sistema suma las hectáreas de los campos vinculados a los centros elegidos y reparte el total en esa proporción. Si algún centro no tiene hectáreas, reparte en partes iguales."),
        ("¿Puedo imputar pagos con cheque?",
         "En esta etapa no. El reparto está disponible para gastos pagados con efectivo, transferencia o débito, y para las facturas de compra."),
        ("Si borro una compra, ¿qué pasa con su reparto?",
         "Se borra solo junto con la compra. No quedan imputaciones sueltas."),
        ("¿Puedo cambiar el reparto de una factura ya cargada?",
         "Sí, editando la factura. Al guardar, el reparto anterior se reemplaza por el nuevo."),
        ("¿Por qué un centro no aparece en el reporte?",
         "Porque todavía no se le imputó ningún gasto o compra en el período elegido. Ampliá el rango de fechas o revisá las imputaciones."),
        ("¿Puedo exportar el reporte?",
         "Sí, con el botón Excel baja el resumen por centro y el detalle de movimientos para abrirlo en una planilla."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
